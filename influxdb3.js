/**
 * InfluxDB v3 nodes for Node-RED
 */

module.exports = function(RED) {
    const { InfluxDBClient, Point } = require('@influxdata/influxdb3-client');

    /**
     * Configuration node to hold InfluxDB v3 connection details
     */
    function InfluxDB3ConfigNode(config) {
        RED.nodes.createNode(this, config);
        
        this.host = config.host;
        this.database = config.database;
        this.name = config.name;
        
        // Store token as a credential
        this.token = this.credentials.token;
        
        // Client instance (will be created on demand)
        this.client = null;
        
        // Get or create a client instance
        this.getClient = function() {
            if (!this.client) {
                try {
                    this.client = new InfluxDBClient({
                        host: this.host,
                        token: this.token,
                        database: this.database
                    });
                } catch (error) {
                    throw new Error(`Failed to create InfluxDB client: ${error.message}`);
                }
            }
            return this.client;
        };
        
        // Clean up on close
        this.on('close', function() {
            if (this.client) {
                try {
                    this.client.close();
                    this.client = null;
                } catch (error) {
                    // Ignore errors on close
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
        
        if (!this.influxdb) {
            this.error('InfluxDB v3 config not set');
            this.status({ fill: 'red', shape: 'dot', text: 'no config' });
            return;
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
                    lineProtocol = msg.payload;
                } else if (msg.payload && typeof msg.payload === 'object') {
                    // Build line protocol from payload object
                    const measurement = msg.measurement || node.measurement;
                    
                    if (!measurement) {
                        throw new Error('Measurement not specified');
                    }
                    
                    const point = new Point(measurement);
                    
                    // Add tags
                    if (msg.payload.tags && typeof msg.payload.tags === 'object') {
                        for (const [key, value] of Object.entries(msg.payload.tags)) {
                            if (value !== null && value !== undefined) {
                                point.setTag(key, String(value));
                            }
                        }
                    }
                    
                    // Add fields
                    if (msg.payload.fields && typeof msg.payload.fields === 'object') {
                        for (const [key, value] of Object.entries(msg.payload.fields)) {
                            if (value !== null && value !== undefined) {
                                if (typeof value === 'number') {
                                    if (Number.isInteger(value)) {
                                        point.setIntegerField(key, value);
                                    } else {
                                        point.setFloatField(key, value);
                                    }
                                } else if (typeof value === 'boolean') {
                                    point.setBooleanField(key, value);
                                } else {
                                    point.setStringField(key, String(value));
                                }
                            }
                        }
                    } else {
                        // If no 'fields' property, treat all non-tag properties as fields
                        for (const [key, value] of Object.entries(msg.payload)) {
                            if (key !== 'tags' && key !== 'timestamp' && value !== null && value !== undefined) {
                                if (typeof value === 'number') {
                                    if (Number.isInteger(value)) {
                                        point.setIntegerField(key, value);
                                    } else {
                                        point.setFloatField(key, value);
                                    }
                                } else if (typeof value === 'boolean') {
                                    point.setBooleanField(key, value);
                                } else if (typeof value !== 'object') {
                                    point.setStringField(key, String(value));
                                }
                            }
                        }
                    }
                    
                    // Add timestamp if provided
                    if (msg.payload.timestamp) {
                        if (msg.payload.timestamp instanceof Date) {
                            point.setTimestamp(msg.payload.timestamp);
                        } else if (typeof msg.payload.timestamp === 'number') {
                            point.setTimestamp(new Date(msg.payload.timestamp));
                        }
                    } else if (msg.timestamp) {
                        if (msg.timestamp instanceof Date) {
                            point.setTimestamp(msg.timestamp);
                        } else if (typeof msg.timestamp === 'number') {
                            point.setTimestamp(new Date(msg.timestamp));
                        }
                    }
                    
                    lineProtocol = point.toLineProtocol();
                    
                    if (!lineProtocol) {
                        throw new Error('No fields to write - at least one field is required');
                    }
                } else {
                    throw new Error('Invalid payload format. Expected string (line protocol) or object with fields');
                }
                
                // Write to InfluxDB
                await client.write(lineProtocol, targetDatabase);
                
                node.status({ fill: 'green', shape: 'dot', text: 'written' });
                
                // Clear status after 3 seconds
                setTimeout(() => {
                    node.status({});
                }, 3000);
                
                send(msg);
                done();
                
            } catch (error) {
                node.status({ fill: 'red', shape: 'dot', text: 'error' });
                done(error);
            }
        });
        
        node.on('close', function() {
            node.status({});
        });
    }
    
    RED.nodes.registerType('influxdb3-write', InfluxDB3WriteNode);
};

