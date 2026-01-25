# node-red-contrib-influxdb3

[![npm version](https://badge.fury.io/js/node-red-contrib-influxdb3.svg)](https://www.npmjs.com/package/node-red-contrib-influxdb3)
[![npm downloads](https://img.shields.io/npm/dm/node-red-contrib-influxdb3.svg)](https://www.npmjs.com/package/node-red-contrib-influxdb3)
[![Node-RED](https://img.shields.io/badge/Node--RED-contrib-red.svg)](https://flows.nodered.org/node/node-red-contrib-influxdb3)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Node-RED nodes for writing data to InfluxDB v3.

This package provides Node-RED integration with InfluxDB v3 using the official [@influxdata/influxdb3-client](https://github.com/InfluxCommunity/influxdb3-js) JavaScript library.

## Installation

### From npm (when published)

```bash
cd ~/.node-red
npm install node-red-contrib-influxdb3
```

### From local directory

```bash
cd ~/.node-red
npm install /path/to/node-red-contrib-influxdb3
```

### Development Installation

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Link to your Node-RED installation:
   ```bash
   cd ~/.node-red
   npm install /path/to/node-red-contrib-influxdb3
   ```
4. Restart Node-RED

## Nodes

This package includes two nodes:

### InfluxDB v3 Config Node

A configuration node that stores connection details for your InfluxDB v3 instance.

**Configuration:**
- **Name**: A friendly name for the connection
- **Host**: Your InfluxDB v3 host URL (e.g., `https://us-east-1-1.aws.cloud2.influxdata.com`)
- **Token**: Your InfluxDB v3 authentication token
- **Database**: The default database (bucket) name
- **Verify TLS**: Toggle TLS certificate verification (unchecked sets `NODE_TLS_REJECT_UNAUTHORIZED=0`)
- **CA Cert Path**: Optional filesystem path for a custom root CA (`NODE_EXTRA_CA_CERTS`)

### InfluxDB v3 Write Node

Writes data points to InfluxDB v3.

**Configuration:**
- **Connection**: Select an InfluxDB v3 config node
- **Name**: Optional node name
- **Measurement**: Default measurement name (can be overridden by `msg.measurement`)
- **Database**: Optional database override (uses connection default if not set)

## Usage

### Input Message Formats

The write node accepts data in multiple formats:

#### 1. Line Protocol String

Send data as a string in InfluxDB line protocol format:

```javascript
msg.payload = "temperature,location=room1 value=21.5";
return msg;
```

#### 2. Object with Fields and Tags

Send an object with explicit `fields` and `tags` properties:

```javascript
msg.measurement = "temperature";
msg.payload = {
    fields: {
        value: 21.5,
        humidity: 65
    },
    tags: {
        location: "room1",
        sensor: "dht22"
    },
    timestamp: Date.now() // optional
};
return msg;
```

#### 3. Simplified Object Format

Send an object where all properties (except 'tags' and 'timestamp') are treated as fields:

```javascript
msg.measurement = "environment";
msg.payload = {
    temperature: 21.5,
    humidity: 65,
    pressure: 1013.25,
    tags: {
        room: "bedroom",
        floor: "2"
    }
};
return msg;
```

### Data Types

**Important:** By default, **all numbers are written as floats** to avoid schema conflicts in InfluxDB. This is because JavaScript doesn't distinguish between `1.0` and `1` (both equal `1`), which can cause issues when InfluxDB expects a float but receives an integer.

When using object format, the node handles data types as follows:
- **Numbers**: Written as **float fields** by default
- **Integers**: Must be explicitly marked (see below)
- **Booleans**: Written as boolean fields
- **Strings**: Written as string fields
- **Tags**: Always converted to strings

#### Writing Integer Fields

To write integers explicitly, use one of these methods:

**Method 1: Using the `integers` array**
```javascript
msg.payload = {
    fields: {
        temperature: 21.5,   // float
        count: 42,           // will be float by default
        total: 100           // will be float by default
    },
    integers: ['count', 'total']  // mark these as integers
};
```

**Method 2: Using the `i` suffix**
```javascript
msg.payload = {
    fields: {
        temperature: 21.5,   // float
        count: "42i",        // integer (note the string with 'i' suffix)
        total: "100i"        // integer
    }
};
```

**Example with both floats and integers:**
```javascript
msg.measurement = "sensor_data";
msg.payload = {
    temperature: 21.5,      // float
    humidity: 65.0,         // float (even though it looks like an integer)
    event_count: "50i",     // integer
    tags: {
        location: "room1"
    }
};
```

### Message Properties

The following message properties can be used to override node configuration:

- `msg.measurement` - Override the measurement name
- `msg.database` - Override the database name
- `msg.timestamp` - Set the timestamp for the data point (Date object or milliseconds)
- `msg.payload.integers` - Array of field names to write as integers (e.g., `['count', 'total']`)

## Examples

### Example 1: Temperature Sensor

```javascript
// Function node
msg.measurement = "temperature";
msg.payload = {
    value: 21.5,
    tags: {
        location: "living_room",
        sensor_id: "temp_001"
    }
};
return msg;
```

### Example 2: Multi-Sensor Data

```javascript
// Function node
msg.measurement = "environment";
msg.payload = {
    fields: {
        temperature: 22.3,
        humidity: 58,
        co2: 412,
        light: 850
    },
    tags: {
        room: "office",
        floor: "3",
        building: "A"
    }
};
return msg;
```

### Example 3: MQTT to InfluxDB

```
[MQTT In] --> [JSON Parse] --> [Function] --> [InfluxDB v3 Write]
```

Function node:
```javascript
// Parse MQTT topic for location
const location = msg.topic.split('/')[1];

msg.measurement = "sensor_data";
msg.payload = {
    temperature: msg.payload.temp,
    humidity: msg.payload.hum,
    tags: {
        location: location
    }
};
return msg;
```

### Example 4: Using Line Protocol

```javascript
// Function node - direct line protocol
const location = "warehouse";
const temp = 18.5;
const humidity = 72;

msg.payload = `climate,location=${location} temperature=${temp},humidity=${humidity}`;
return msg;
```

### Example 5: Multiple Databases

```javascript
// Write to different databases based on data type
if (msg.payload.type === "critical") {
    msg.database = "critical-events";
} else {
    msg.database = "general-logs";
}

msg.measurement = "events";
msg.payload = {
    severity: msg.payload.severity,
    message: msg.payload.msg,
    tags: {
        type: msg.payload.type
    }
};
return msg;
```

## Sample Flow

Import this flow into Node-RED to get started:

```json
[
    {
        "id": "influxdb3-config-node",
        "type": "influxdb3-config",
        "name": "My InfluxDB v3",
        "host": "https://us-east-1-1.aws.cloud2.influxdata.com",
        "database": "my-database"
    },
    {
        "id": "inject-node",
        "type": "inject",
        "name": "Generate Data",
        "props": [{"p": "payload"}],
        "repeat": "5",
        "topic": "",
        "payload": "",
        "payloadType": "date",
        "x": 140,
        "y": 100,
        "wires": [["function-node"]]
    },
    {
        "id": "function-node",
        "type": "function",
        "name": "Format Data",
        "func": "msg.measurement = 'temperature';\nmsg.payload = {\n    value: 20 + Math.random() * 10,\n    tags: {\n        location: 'office'\n    }\n};\nreturn msg;",
        "x": 320,
        "y": 100,
        "wires": [["influxdb3-write-node"]]
    },
    {
        "id": "influxdb3-write-node",
        "type": "influxdb3-write",
        "name": "Write to InfluxDB",
        "influxdb": "influxdb3-config-node",
        "measurement": "",
        "database": "",
        "x": 530,
        "y": 100,
        "wires": [["debug-node"]]
    },
    {
        "id": "debug-node",
        "type": "debug",
        "name": "Debug",
        "x": 730,
        "y": 100,
        "wires": []
    }
]
```

## Configuration with Environment Variables

You can use environment variables in the configuration node:

- `INFLUX_HOST` - InfluxDB v3 host URL
- `INFLUX_TOKEN` - Authentication token
- `INFLUX_DATABASE` - Default database name

Simply reference them in the Node-RED UI using `${INFLUX_HOST}` syntax (if using Node-RED environment variable substitution).

## Troubleshooting

### Connection Issues

- Verify your host URL is correct and includes `https://`
- Check that your token has write permissions for the database
- Ensure the database name exists in your InfluxDB v3 instance

### TLS / Custom Certificates

If you are connecting to a local InfluxDB v3 instance with a custom certificate:

- Set **CA Cert Path** in the config node to the PEM file containing your root CA. This sets `NODE_EXTRA_CA_CERTS` for the Node-RED process.
- As a last resort, disable **Verify TLS** to set `NODE_TLS_REJECT_UNAUTHORIZED=0` (this disables TLS verification globally for the process).

### Data Not Appearing

- Check the node status - it should show "written" briefly after successful writes
- Verify at least one field is provided (InfluxDB requires at least one field)
- Check that field values are not null or undefined

### Error Messages

The node will display error status and log details to the Node-RED debug panel:
- **"no config"** - The InfluxDB v3 config node is not selected
- **"error"** - Check the debug panel for details

## Requirements

- Node-RED v2.0.0 or higher
- InfluxDB v3 instance (Cloud or Edge)

## License

MIT

## Links

- [InfluxDB v3 JavaScript Client](https://github.com/InfluxCommunity/influxdb3-js)
- [InfluxDB v3 Documentation](https://docs.influxdata.com/influxdb/v3/)
- [Node-RED](https://nodered.org/)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

