/**
 * InfluxDB v3 nodes for Node-RED
 */

module.exports = function(RED) {
    const { InfluxDBClient, Point } = require('@influxdata/influxdb3-client');

    /**
     * Normalize host URL to ensure it has trailing slash
     */
    function normalizeHost(host) {
        if (!host || typeof host !== 'string') {
            return host;
        }
        return host.endsWith('/') ? host : host + '/';
    }

    /**
     * Process a field value and add it to a Point
     */
    function addFieldToPoint(point, key, value, integerFields) {
        if (value === null || value === undefined) {
            return false;
        }

        // Handle string with 'i' suffix for integers (e.g., "42i")
        if (typeof value === 'string' && /^-?\d+i$/.test(value)) {
            const intValue = parseInt(value.slice(0, -1), 10);
            // Validate parsed value
            if (!isNaN(intValue) && isFinite(intValue)) {
                point.setIntegerField(key, intValue);
                return true;
            }
        } else if (typeof value === 'number') {
            // Validate number
            if (!isFinite(value)) {
                RED.log.warn(`Skipping field '${key}': value is not finite (${value})`);
                return false;
            }
            
            // Default to float for all numbers (safe default)
            // Use integer only if explicitly marked in 'integers' array
            if (integerFields.has(key)) {
                const intValue = Math.floor(value);
                if (intValue !== value) {
                    RED.log.warn(`Field '${key}': truncating ${value} to ${intValue} for integer field`);
                }
                point.setIntegerField(key, intValue);
            } else {
                point.setFloatField(key, value);
            }
            return true;
        } else if (typeof value === 'boolean') {
            point.setBooleanField(key, value);
            return true;
        } else if (typeof value === 'string') {
            point.setStringField(key, value);
            return true;
        } else {
            // Complex types (arrays, objects) are not supported
            RED.log.warn(`Skipping field '${key}': unsupported type ${typeof value}`);
            return false;
        }
        
        return false;
    }

    /**
     * Configuration node to hold InfluxDB v3 connection details
     */
    function InfluxDB3ConfigNode(config) {
        RED.nodes.createNode(this, config);
        
        this.host = config.host;
        this.database = config.database;
        this.name = config.name;
        this.tlsRejectUnauthorized = config.tlsRejectUnauthorized !== false;
        this.caCertPath = config.caCertPath;
        
        // Store token as a credential
        this.token = this.credentials.token;
        
        // Client instance (will be created on demand)
        this.client = null;
        
        // Get or create a client instance
        this.getClient = function() {
            if (!this.client) {
                // Validate configuration
                if (!this.host) {
                    throw new Error('InfluxDB host is not configured');
                }
                if (!this.token) {
                    throw new Error('InfluxDB token is not configured');
                }
                if (!this.database) {
                    throw new Error('InfluxDB database is not configured');
                }
                
                try {
                    const normalizedHost = normalizeHost(this.host);

                    if (!this.tlsRejectUnauthorized) {
                        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
                        RED.log.warn('InfluxDB v3: TLS certificate verification is disabled for this process.');
                    }

                    if (this.caCertPath) {
                        process.env.NODE_EXTRA_CA_CERTS = this.caCertPath;
                        RED.log.info(`InfluxDB v3: Using extra CA certificates from ${this.caCertPath}`);
                    }
                    
                    RED.log.info(`InfluxDB v3: Connecting to ${normalizedHost} with database ${this.database}`);
                    
                    this.client = new InfluxDBClient({
                        host: normalizedHost,
                        token: this.token,
                        database: this.database
                    });
                    
                    RED.log.info(`InfluxDB v3: Client created successfully`);
                } catch (error) {
                    RED.log.error(`InfluxDB v3: Failed to create client - ${error.message}`);
                    throw new Error(`Failed to create InfluxDB client: ${error.message}`);
                }
            }
            return this.client;
        };
        
        // Clean up on close
        this.on('close', function() {
            if (this.client) {
                try {
                    RED.log.info('InfluxDB v3: Closing client connection');
                    this.client.close();
                    this.client = null;
                } catch (error) {
                    RED.log.warn(`InfluxDB v3: Error closing client - ${error.message}`);
                }
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
     */
    function InfluxDB3WriteNode(config) {
        RED.nodes.createNode(this, config);
        
        this.influxdb = RED.nodes.getNode(config.influxdb);
        this.measurement = config.measurement;
        this.database = config.database;
        
        const node = this;
        let statusTimeout = null;
        
        if (!this.influxdb) {
            this.error('InfluxDB v3 config not set');
            this.status({ fill: 'red', shape: 'dot', text: 'no config' });
            return;
        }
        
        // Helper to set status with auto-clear
        function setStatus(status, clearAfterMs = 0) {
            if (statusTimeout) {
                clearTimeout(statusTimeout);
                statusTimeout = null;
            }
            
            node.status(status);
            
            if (clearAfterMs > 0) {
                statusTimeout = setTimeout(() => {
                    node.status({});
                    statusTimeout = null;
                }, clearAfterMs);
            }
        }
        
        // Process incoming messages
        node.on('input', async function(msg, send, done) {
            // For Node-RED 0.x compatibility
            send = send || function() { node.send.apply(node, arguments); };
            done = done || function(err) { 
                if (err) {
                    node.error(err, msg);
                }
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
                    // Build line protocol from payload object
                    const measurement = msg.measurement || node.measurement;
                    
                    if (!measurement) {
                        throw new Error('Measurement not specified');
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
                            if (addFieldToPoint(point, key, value, integerFields)) {
                                fieldCount++;
                            }
                        }
                    } else {
                        // Simplified format: treat all non-reserved properties as fields
                        const reservedKeys = new Set(['tags', 'timestamp', 'integers', 'fields']);
                        for (const [key, value] of Object.entries(msg.payload)) {
                            if (!reservedKeys.has(key)) {
                                if (addFieldToPoint(point, key, value, integerFields)) {
                                    fieldCount++;
                                }
                            }
                        }
                    }
                    
                    if (fieldCount === 0) {
                        throw new Error('No valid fields to write - at least one field is required');
                    }
                    
                    // Add timestamp if provided
                    if (msg.payload.timestamp) {
                        const ts = msg.payload.timestamp;
                        if (ts instanceof Date && !isNaN(ts.getTime())) {
                            point.setTimestamp(ts);
                        } else if (typeof ts === 'number' && isFinite(ts) && ts > 0) {
                            point.setTimestamp(new Date(ts));
                        } else {
                            node.warn(`Invalid timestamp in payload: ${ts}`);
                        }
                    } else if (msg.timestamp) {
                        const ts = msg.timestamp;
                        if (ts instanceof Date && !isNaN(ts.getTime())) {
                            point.setTimestamp(ts);
                        } else if (typeof ts === 'number' && isFinite(ts) && ts > 0) {
                            point.setTimestamp(new Date(ts));
                        } else {
                            node.warn(`Invalid timestamp in msg: ${ts}`);
                        }
                    }
                    
                    lineProtocol = point.toLineProtocol();
                    
                    if (!lineProtocol || lineProtocol.trim() === '') {
                        throw new Error('Generated line protocol is empty');
                    }
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
