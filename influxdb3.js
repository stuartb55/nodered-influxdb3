/**
 * InfluxDB v3 nodes for Node-RED
 * @module node-red-contrib-influxdb3
 */

module.exports = function(RED) {
    // @influxdata/influxdb3-client Point API:
    //   Point.setIntegerField(name, value)
    //   Point.setFloatField(name, value)
    //   Point.setStringField(name, value)
    //   Point.setBooleanField(name, value)
    //   Point.setTag(name, value)
    //   Point.setTimestamp(date)
    //   Point.toLineProtocol()
    const { InfluxDBClient, Point, PartialWriteError } = require('@influxdata/influxdb3-client');
    const fs = require('fs');
    const { validateLineProtocol } = require('./lib/line-protocol');

    // Heuristic bounds for plausible millisecond timestamps. Values outside this
    // range usually mean the source supplied seconds or nanoseconds instead.
    const MS_TIMESTAMP_PLAUSIBLE_MIN = Date.UTC(2000, 0, 1);
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;

    /**
     * Normalize host URL to ensure it has trailing slash
     * @param {string} host
     * @returns {string}
     */
    function normalizeHost(host) {
        if (!host || typeof host !== 'string') {
            return host;
        }
        return host.endsWith('/') ? host : host + '/';
    }

    /**
     * Configuration node to hold InfluxDB v3 connection details
     * @param {object} config
     */
    function InfluxDB3ConfigNode(config) {
        RED.nodes.createNode(this, config);

        /** @type {string} */
        this.host = config.host;
        /** @type {string} */
        this.database = config.database;
        /** @type {string} */
        this.name = config.name;
        /** @type {boolean} */
        this.tlsRejectUnauthorized = config.tlsRejectUnauthorized !== false;
        /** @type {string} */
        this.caCertPath = config.caCertPath;

        // Store token as a credential (populated by Node-RED runtime)
        /** @type {string} */
        if (!this.credentials) {
            RED.log.warn('InfluxDB v3 config: credentials object is undefined');
        }
        this.token = this.credentials ? this.credentials.token : undefined;

        // Client instance (will be created on demand)
        /** @type {InfluxDBClient|null} */
        this.client = null;

        const configNode = this;

        /**
         * Get or create a client instance
         * @returns {InfluxDBClient}
         */
        configNode.getClient = function() {
            if (!configNode.client) {
                if (!configNode.host) {
                    throw new Error('InfluxDB host is not configured');
                }
                if (!configNode.token) {
                    throw new Error('InfluxDB token is not configured');
                }
                if (!configNode.database) {
                    throw new Error('InfluxDB database is not configured');
                }

                const normalizedHost = normalizeHost(configNode.host);

                // Build per-client transport (TLS) options. These are passed only to this
                // client's HTTPS requests, so they do NOT affect other connections or the
                // rest of the Node-RED process (unlike NODE_TLS_REJECT_UNAUTHORIZED /
                // NODE_EXTRA_CA_CERTS, which are global and read only at process startup).
                const transportOptions = {};

                if (!configNode.tlsRejectUnauthorized) {
                    transportOptions.rejectUnauthorized = false;
                    RED.log.warn(
                        'InfluxDB v3: TLS certificate verification is disabled for this connection. ' +
                        'This is insecure and should only be used for trusted local instances.'
                    );
                }

                if (configNode.caCertPath) {
                    try {
                        transportOptions.ca = fs.readFileSync(configNode.caCertPath);
                        RED.log.info(`InfluxDB v3: Using custom CA certificate from ${configNode.caCertPath}`);
                    } catch (error) {
                        throw new Error(
                            `Failed to read CA certificate from '${configNode.caCertPath}': ${error.message}`,
                            { cause: error }
                        );
                    }
                }

                RED.log.info(`InfluxDB v3: Connecting to ${normalizedHost} with database ${configNode.database}`);

                const clientOptions = {
                    host: normalizedHost,
                    token: configNode.token,
                    database: configNode.database
                };
                if (Object.keys(transportOptions).length > 0) {
                    clientOptions.transportOptions = transportOptions;
                }

                configNode.client = new InfluxDBClient(clientOptions);

                RED.log.info('InfluxDB v3: Client created successfully');
            }
            return configNode.client;
        };

        configNode.on('close', function() {
            if (configNode.client) {
                try {
                    RED.log.info('InfluxDB v3: Closing client connection');
                    configNode.client.close();
                } catch (error) {
                    RED.log.warn(`InfluxDB v3: Error closing client - ${error.message}`);
                }
                configNode.client = null;
            }
        });
    }

    RED.nodes.registerType('influxdb3-config', InfluxDB3ConfigNode, {
        credentials: {
            token: { type: 'password' }
        }
    });

    /**
     * InfluxDB v3 Write Node
     * @param {object} config
     */
    function InfluxDB3WriteNode(config) {
        RED.nodes.createNode(this, config);

        this.influxdb = RED.nodes.getNode(config.influxdb);
        this.measurement = config.measurement;
        this.database = config.database;
        /** @type {boolean} */
        this.allowPartialWrites = config.allowPartialWrites === true;
        /** @type {boolean} */
        this.noSync = config.noSync === true;

        const node = this;
        let statusTimeout = null;

        if (!node.influxdb) {
            node.error('InfluxDB v3 config not set');
            node.status({ fill: 'red', shape: 'dot', text: 'no config' });
            return;
        }

        /**
         * Safely serialize a value for diagnostic logging.
         * Handles circular references and large objects.
         * @param {*} value
         * @param {number} [maxLength=200] - Maximum length before truncation
         * @returns {string}
         */
        function safeStringify(value, maxLength) {
            maxLength = maxLength || 200;
            try {
                const str = JSON.stringify(value);
                if (str && str.length > maxLength) {
                    return str.substring(0, maxLength) + '...(truncated)';
                }
                return str;
            } catch (e) {
                return `[unserializable: ${e.message}]`;
            }
        }

        /**
         * Process a field value and add it to a Point.
         * Returns true if the field was added, false if it was skipped.
         *
         * Uses the type-specific Point methods:
         * - point.setFloatField(name, value) for numbers (default)
         * - point.setIntegerField(name, value) for integers
         * - point.setStringField(name, value) for strings
         * - point.setBooleanField(name, value) for booleans
         *
         * @param {Point} point - The InfluxDB Point to add the field to
         * @param {string} key - The field name
         * @param {*} value - The field value
         * @param {Set<string>} integerFields - Set of field names to treat as integers
         * @param {string} measurement - Measurement name for diagnostic context
         * @returns {boolean} true if the field was added successfully
         */
        function addFieldToPoint(point, key, value, integerFields, measurement) {
            const context = measurement ? ` (measurement: '${measurement}')` : '';

            if (value === null || value === undefined) {
                node.warn(`Skipping field '${key}': value is ${value}${context}`);
                return false;
            }

            if (typeof value === 'object') {
                const typeName = Array.isArray(value)
                    ? 'Array'
                    : (value.constructor ? value.constructor.name : 'object');
                node.warn(
                    `Skipping field '${key}': unsupported type 'object' (${typeName})${context}. ` +
                    `Actual value: ${safeStringify(value)}. ` +
                    `The value for field '${key}' must be a number, string, or boolean.`
                );
                return false;
            }

            if (typeof value === 'string') {
                // Check for integer suffix e.g. "42i"
                if (/^-?\d+i$/.test(value)) {
                    const parsed = parseInt(value.slice(0, -1), 10);
                    if (!Number.isSafeInteger(parsed)) {
                        node.warn(
                            `Field '${key}': integer value '${value}' exceeds JavaScript's safe integer ` +
                            `range and loses precision (stored as ${parsed})${context}.`
                        );
                    }
                    point.setIntegerField(key, parsed);
                    return true;
                }
                point.setStringField(key, value);
                return true;
            }

            if (typeof value === 'boolean') {
                point.setBooleanField(key, value);
                return true;
            }

            if (typeof value === 'number') {
                if (!isFinite(value)) {
                    node.warn(
                        `Skipping field '${key}': numeric value is ${value} (not finite)${context}. ` +
                        `Check the source data for NaN or Infinity.`
                    );
                    return false;
                }
                if (integerFields && integerFields.has(key)) {
                    if (!Number.isInteger(value)) {
                        node.warn(
                            `Field '${key}' is marked as integer but value is ${value}${context}. ` +
                            `Value will be truncated to ${Math.trunc(value)}.`
                        );
                    }
                    point.setIntegerField(key, Math.trunc(value));
                } else {
                    point.setFloatField(key, value);
                }
                return true;
            }

            node.warn(
                `Skipping field '${key}': unsupported type '${typeof value}'${context}. ` +
                `Value: ${safeStringify(value)}`
            );
            return false;
        }

        /**
         * Set node status with optional auto-clear
         * @param {object} status
         * @param {number} [clearAfterMs=0]
         */
        function setStatus(status, clearAfterMs) {
            if (statusTimeout) {
                clearTimeout(statusTimeout);
                statusTimeout = null;
            }

            node.status(status);

            if (clearAfterMs && clearAfterMs > 0) {
                statusTimeout = setTimeout(function() {
                    node.status({});
                    statusTimeout = null;
                }, clearAfterMs);
            }
        }

        /**
         * Build line protocol from an object payload.
         * @param {object} msg - The incoming Node-RED message
         * @returns {{lineProtocol: string}|{error: string}} result or error
         */
        function buildLineProtocol(msg) {
            // Trim each source before the fallback so a blank/whitespace-only
            // msg.measurement falls back to the node default (instead of being used
            // verbatim) and never produces a measurement made of spaces.
            const trim = (m) => (typeof m === 'string' ? m.trim() : m);
            const measurement = trim(msg.measurement) || trim(node.measurement);

            if (!measurement) {
                return { error: 'Measurement not specified' };
            }

            const point = new Point(measurement);

            // Add tags
            if (msg.payload.tags && typeof msg.payload.tags === 'object' && !Array.isArray(msg.payload.tags)) {
                const tagContext = measurement ? ` (measurement: '${measurement}')` : '';
                for (const [key, value] of Object.entries(msg.payload.tags)) {
                    if (value === null || value === undefined) {
                        continue;
                    }
                    // Guard against objects/arrays, which would otherwise be coerced to
                    // useless strings like "[object Object]". Mirrors addFieldToPoint.
                    if (typeof value === 'object') {
                        const typeName = Array.isArray(value)
                            ? 'Array'
                            : (value.constructor ? value.constructor.name : 'object');
                        node.warn(
                            `Skipping tag '${key}': unsupported type 'object' (${typeName})${tagContext}. ` +
                            `Actual value: ${safeStringify(value)}. ` +
                            `Tag values must be a string, number, or boolean.`
                        );
                        continue;
                    }
                    point.setTag(key, String(value));
                }
            }

            // Get list of fields that should be treated as integers
            const integerFields = new Set(msg.payload.integers || []);
            let fieldCount = 0;

            // Add fields
            if (msg.payload.fields && typeof msg.payload.fields === 'object' && !Array.isArray(msg.payload.fields)) {
                // Explicit fields object
                for (const [key, value] of Object.entries(msg.payload.fields)) {
                    if (addFieldToPoint(point, key, value, integerFields, measurement)) {
                        fieldCount++;
                    }
                }
            } else {
                if (msg.payload.fields !== null && msg.payload.fields !== undefined) {
                    const typeName = Array.isArray(msg.payload.fields)
                        ? 'Array'
                        : typeof msg.payload.fields;
                    node.warn(
                        `'fields' is present but is not a plain object (${typeName}) (measurement: '${measurement}'). ` +
                        `It will be ignored and the other payload properties will be treated as fields.`
                    );
                }
                // Simplified format: treat all non-reserved properties as fields.
                // 'measurement' is reserved too so that array items like
                // { measurement: 'temp', value: 1 } don't write it as a string field.
                const reservedKeys = new Set(['measurement', 'tags', 'timestamp', 'integers', 'fields']);
                for (const [key, value] of Object.entries(msg.payload)) {
                    if (!reservedKeys.has(key)) {
                        if (addFieldToPoint(point, key, value, integerFields, measurement)) {
                            fieldCount++;
                        }
                    }
                }
            }

            if (fieldCount === 0) {
                return {
                    error: 'No valid fields to write - all fields were skipped or payload had no fields. ' +
                           'Payload was: ' + safeStringify(msg.payload)
                };
            }

            // Handle timestamp — use nullish coalescing to preserve falsy-but-valid values like 0
            const ts = (msg.payload.timestamp !== null && msg.payload.timestamp !== undefined)
                ? msg.payload.timestamp
                : msg.timestamp;
            if (ts !== null && ts !== undefined) {
                if (ts instanceof Date && !isNaN(ts.getTime())) {
                    point.setTimestamp(ts);
                } else if (typeof ts === 'number' && isFinite(ts) && ts >= 0) {
                    const date = new Date(ts);
                    if (isNaN(date.getTime())) {
                        // Beyond the representable Date range (±8.64e15 ms) — almost
                        // always a nanosecond timestamp passed where ms are expected.
                        node.warn(
                            `Invalid timestamp: ${ts} is outside the representable date range. ` +
                            `Numeric timestamps are interpreted as milliseconds - if the source ` +
                            `supplies nanoseconds, convert to milliseconds first. The timestamp ` +
                            `was ignored; InfluxDB will assign the write time.`
                        );
                    } else {
                        // 0 is deliberately allowed without a warning (explicit epoch).
                        if (ts !== 0 && (ts < MS_TIMESTAMP_PLAUSIBLE_MIN || ts > Date.now() + ONE_DAY_MS)) {
                            node.warn(
                                `Numeric timestamp ${ts} resolves to ${date.toISOString()}. ` +
                                `Numeric timestamps are interpreted as milliseconds - if the source ` +
                                `supplies seconds or nanoseconds, convert to milliseconds first.`
                            );
                        }
                        point.setTimestamp(date);
                    }
                } else if (typeof ts === 'string' && ts.trim() !== '') {
                    const parsed = new Date(ts);
                    if (!isNaN(parsed.getTime())) {
                        point.setTimestamp(parsed);
                    } else {
                        node.warn(`Invalid timestamp string: '${ts}'`);
                    }
                } else {
                    node.warn(`Invalid timestamp: ${safeStringify(ts)} (type: ${typeof ts})`);
                }
            }

            const lp = point.toLineProtocol();

            if (!lp || lp.trim() === '') {
                return { error: 'Generated line protocol is empty' };
            }

            return { lineProtocol: lp };
        }

        node.on('input', async function(msg, send, done) {
            try {
                const client = node.influxdb.getClient();

                // Determine the database to use. Trim each source before the fallback so a
                // blank/whitespace-only msg.database falls back instead of being used verbatim.
                const trimDb = (d) => (typeof d === 'string' ? d.trim() : d);
                const targetDatabase = trimDb(msg.database) || trimDb(node.database) || trimDb(node.influxdb.database);

                if (!targetDatabase) {
                    throw new Error('Database not specified');
                }

                let lineProtocol;

                // Check if msg.payload is already in line protocol format
                if (typeof msg.payload === 'string') {
                    lineProtocol = msg.payload.trim();
                    if (!lineProtocol) {
                        throw new Error('Line protocol string is empty');
                    }

                    // Validate line protocol format
                    const validationError = validateLineProtocol(lineProtocol);
                    if (validationError) {
                        throw new Error(validationError);
                    }
                } else if (Array.isArray(msg.payload)) {
                    // Handle array of measurements
                    if (msg.payload.length === 0) {
                        throw new Error('Payload array is empty');
                    }

                    const lineProtocols = [];
                    for (let i = 0; i < msg.payload.length; i++) {
                        const item = msg.payload[i];
                        
                        if (typeof item === 'string') {
                            // String line protocol
                            const lp = item.trim();
                            if (!lp) {
                                throw new Error(`Array item ${i} is an empty string`);
                            }
                            const validationError = validateLineProtocol(lp);
                            if (validationError) {
                                throw new Error(`Array item ${i}: ${validationError}`);
                            }
                            lineProtocols.push(lp);
                        } else if (item && typeof item === 'object' && !Array.isArray(item)) {
                            // Object payload - build line protocol
                            const tempMsg = {
                                ...msg,
                                payload: item,
                                measurement: item.measurement || msg.measurement || node.measurement
                            };
                            const result = buildLineProtocol(tempMsg);
                            if (result.error) {
                                throw new Error(`Array item ${i}: ${result.error}`);
                            }
                            lineProtocols.push(result.lineProtocol);
                        } else {
                            throw new Error(
                                `Array item ${i} has invalid format. Expected string (line protocol) or object with fields. ` +
                                `Received: ${typeof item}`
                            );
                        }
                    }
                    
                    lineProtocol = lineProtocols.join('\n');
                } else if (msg.payload && typeof msg.payload === 'object') {
                    const result = buildLineProtocol(msg);
                    if (result.error) {
                        throw new Error(result.error);
                    }
                    lineProtocol = result.lineProtocol;
                } else {
                    const actualType = typeof msg.payload;
                    const detail = msg.payload === null
                        ? 'null'
                        : msg.payload === undefined
                            ? 'undefined'
                            : `${actualType}${msg.payload && msg.payload.constructor ? ` [${msg.payload.constructor.name}]` : ''}: ${safeStringify(msg.payload)}`;
                    throw new Error(
                        `Invalid payload format. Expected string (line protocol), object with fields, or array of objects/strings. ` +
                        `Received: ${detail}`
                    );
                }

                // Both acceptPartial and noSync exist only on the V3 API endpoint,
                // so opting into either selects it. With neither enabled, no write
                // options are passed and the client default (V2 endpoint) is used,
                // preserving previous behaviour.
                let writeOptions = null;
                if (node.allowPartialWrites || node.noSync) {
                    writeOptions = { useV2Api: false };
                    if (node.noSync) {
                        writeOptions.noSync = true;
                    }
                    if (!node.allowPartialWrites) {
                        // noSync without partial writes: keep the all-or-nothing
                        // semantics the V2 endpoint would have provided.
                        writeOptions.acceptPartial = false;
                    }
                }

                // Write to InfluxDB
                if (writeOptions) {
                    await client.write(lineProtocol, targetDatabase, undefined, writeOptions);
                } else {
                    await client.write(lineProtocol, targetDatabase);
                }

                setStatus({ fill: 'green', shape: 'dot', text: 'written' }, 3000);

                send(msg);
                done();

            } catch (error) {
                // The client raises PartialWriteError both when the server accepted
                // the valid lines (partial write occurred) and when it rejected the
                // whole batch (acceptPartial=false). Only the former is a partial
                // success; the server signals it with this specific error text.
                if (node.allowPartialWrites &&
                    error instanceof PartialWriteError &&
                    typeof error.message === 'string' &&
                    error.message.toLowerCase().includes('partial write')) {
                    const lineErrors = error.lineErrors || [];
                    const detail = lineErrors
                        .map((le) => `line ${le.lineNumber}: ${le.errorMessage}`)
                        .join('; ');
                    node.warn(
                        `Partial write: InfluxDB rejected ${lineErrors.length} line(s), ` +
                        `the remaining lines were written. ${detail}`
                    );
                    msg.partialWriteErrors = lineErrors;
                    setStatus({
                        fill: 'yellow',
                        shape: 'dot',
                        text: `partial write: ${lineErrors.length} line(s) rejected`
                    });
                    send(msg);
                    done();
                    return;
                }

                const shortMsg = error.message
                    ? (error.message.length > 80 ? error.message.substring(0, 80) + '...' : error.message)
                    : 'unknown error';
                setStatus({ fill: 'red', shape: 'dot', text: shortMsg });
                done(error);
            }
        });

        node.on('close', function() {
            if (statusTimeout) {
                clearTimeout(statusTimeout);
                statusTimeout = null;
            }
            node.status({});
        });
    }

    RED.nodes.registerType('influxdb3-write', InfluxDB3WriteNode);
};
