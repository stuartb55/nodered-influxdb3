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
    const { InfluxDBClient, Point } = require('@influxdata/influxdb3-client');

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

                if (!configNode.tlsRejectUnauthorized) {
                    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
                    RED.log.warn('InfluxDB v3: TLS certificate verification is disabled for this process.');
                }

                if (configNode.caCertPath) {
                    process.env.NODE_EXTRA_CA_CERTS = configNode.caCertPath;
                    RED.log.info(`InfluxDB v3: Using extra CA certificates from ${configNode.caCertPath}`);
                }

                RED.log.info(`InfluxDB v3: Connecting to ${normalizedHost} with database ${configNode.database}`);

                configNode.client = new InfluxDBClient({
                    host: normalizedHost,
                    token: configNode.token,
                    database: configNode.database
                });

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
         * @returns {string}
         */
        function safeStringify(value) {
            try {
                return JSON.stringify(value);
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
                    point.setIntegerField(key, parseInt(value.slice(0, -1), 10));
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
                            `Value will be truncated to ${Math.floor(value)} using Math.floor.`
                        );
                    }
                    point.setIntegerField(key, Math.floor(value));
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
            const measurement = msg.measurement || node.measurement;

            if (!measurement) {
                return { error: 'Measurement not specified' };
            }

            const point = new Point(measurement);

            // Add tags
            if (msg.payload.tags && typeof msg.payload.tags === 'object' && !Array.isArray(msg.payload.tags)) {
                for (const [key, value] of Object.entries(msg.payload.tags)) {
                    if (value !== null && value !== undefined) {
                        point.setTag(key, String(value));
                    }
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
                // Simplified format: treat all non-reserved properties as fields
                const reservedKeys = new Set(['tags', 'timestamp', 'integers', 'fields']);
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
                    point.setTimestamp(new Date(ts));
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

        // Process incoming messages
        node.on('input', async function(msg, send, done) {
            // For Node-RED 0.x compatibility
            send = send || function(m) { node.send(m); };
            done = done || function(err) {
                if (err) { node.error(err, msg); }
            };

            try {
                const client = node.influxdb.getClient();

                // Determine the database to use
                const targetDatabase = msg.database || node.database || node.influxdb.database;

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
                } else if (msg.payload && typeof msg.payload === 'object' && !Array.isArray(msg.payload)) {
                    const result = buildLineProtocol(msg);
                    if (result.error) {
                        throw new Error(result.error);
                    }
                    lineProtocol = result.lineProtocol;
                } else {
                    throw new Error('Invalid payload format. Expected string (line protocol) or object with fields');
                }

                // Write to InfluxDB
                await client.write(lineProtocol, targetDatabase);

                setStatus({ fill: 'green', shape: 'dot', text: 'written' }, 3000);

                send(msg);
                done();

            } catch (error) {
                setStatus({ fill: 'red', shape: 'dot', text: 'error' });
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
