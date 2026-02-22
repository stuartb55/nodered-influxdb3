const path = require('path');

let mockLastClientOptions;
let mockLastClientInstance;
let mockLastPoint;

jest.mock('@influxdata/influxdb3-client', () => {
  class MockInfluxDBClient {
    constructor(options) {
  mockLastClientOptions = options;
  mockLastClientInstance = this;
      this.write = jest.fn().mockResolvedValue(undefined);
      this.close = jest.fn();
    }
  }

  class MockPoint {
    constructor(measurement) {
      this.measurement = measurement;
      this.tags = {};
      this.integerFields = {};
      this.floatFields = {};
      this.stringFields = {};
      this.booleanFields = {};
      this.timestamp = null;
  mockLastPoint = this;
    }

    setTag(key, value) {
      this.tags[key] = value;
    }

    setIntegerField(key, value) {
      this.integerFields[key] = value;
    }

    setFloatField(key, value) {
      this.floatFields[key] = value;
    }

    setStringField(key, value) {
      this.stringFields[key] = value;
    }

    setBooleanField(key, value) {
      this.booleanFields[key] = value;
    }

    setTimestamp(ts) {
      this.timestamp = ts;
    }

    toLineProtocol() {
      return `lp:${this.measurement}`;
    }
  }

  return {
    InfluxDBClient: MockInfluxDBClient,
    Point: MockPoint,
    __getLastClientOptions: () => mockLastClientOptions,
    __getLastClientInstance: () => mockLastClientInstance,
    __getLastPoint: () => mockLastPoint
  };
});

function buildRED() {
  const types = {};
  return {
    log: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    },
    nodes: {
      createNode(node, config) {
        node.credentials = config.credentials || {};
        node.status = jest.fn();
        node.error = jest.fn();
        node.warn = jest.fn();
        node.send = jest.fn();
        node.on = jest.fn((event, handler) => {
          node._handlers = node._handlers || {};
          node._handlers[event] = handler;
        });
      },
      registerType(name, ctor) {
        types[name] = ctor;
      },
      getNode(id) {
        return id;
      }
    },
    _types: types
  };
}

function setup() {
  jest.resetModules();
  const RED = buildRED();
  require('../influxdb3.js')(RED);
  const influxModule = require('@influxdata/influxdb3-client');
  return { RED, influxModule };
}

beforeEach(() => {
  jest.useFakeTimers();
  mockLastClientOptions = undefined;
  mockLastClientInstance = undefined;
  mockLastPoint = undefined;
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

describe('InfluxDB v3 config node', () => {
  test('normalizes host and uses provided config', () => {
    const { RED, influxModule } = setup();
    const ConfigCtor = RED._types['influxdb3-config'];

    const configNode = new ConfigCtor({
      host: 'https://example.com',
      database: 'metrics',
      name: 'Test',
      credentials: { token: 'token' }
    });

    configNode.getClient();

    const options = influxModule.__getLastClientOptions();
    expect(options.host).toBe('https://example.com/');
    expect(options.database).toBe('metrics');
    expect(options.token).toBe('token');
  });

  test('sets extra CA certificate path when configured', () => {
    const original = process.env.NODE_EXTRA_CA_CERTS;
    const { RED } = setup();
    const ConfigCtor = RED._types['influxdb3-config'];

    const configNode = new ConfigCtor({
      host: 'https://example.com',
      database: 'metrics',
      name: 'Test',
      caCertPath: path.join('C:', 'certs', 'root.pem'),
      credentials: { token: 'token' }
    });

    configNode.getClient();

    expect(process.env.NODE_EXTRA_CA_CERTS).toBe(path.join('C:', 'certs', 'root.pem'));
    process.env.NODE_EXTRA_CA_CERTS = original;
  });
});

describe('InfluxDB v3 write node', () => {
  test('writes line protocol from object payload', async () => {
    const { RED, influxModule } = setup();
    const ConfigCtor = RED._types['influxdb3-config'];
    const WriteCtor = RED._types['influxdb3-write'];

    const configNode = new ConfigCtor({
      host: 'https://example.com',
      database: 'metrics',
      name: 'Test',
      credentials: { token: 'token' }
    });

    const writeNode = new WriteCtor({
      influxdb: configNode,
      measurement: 'cpu',
      database: ''
    });

    const msg = {
      measurement: 'cpu',
      payload: {
        fields: {
          temperature: 21.5,
          count: 5
        },
        tags: { location: 'lab' },
        integers: ['count'],
        timestamp: 1700000000000
      }
    };

    const send = jest.fn();
    const done = jest.fn();
    await writeNode._handlers.input(msg, send, done);

    const point = influxModule.__getLastPoint();
    const client = influxModule.__getLastClientInstance();

    expect(point.floatFields.temperature).toBe(21.5);
    expect(point.integerFields.count).toBe(5);
    expect(point.tags.location).toBe('lab');

    expect(client.write).toHaveBeenCalledWith('lp:cpu', 'metrics');
    expect(send).toHaveBeenCalledWith(msg);
    expect(done).toHaveBeenCalled();

    if (writeNode._handlers.close) {
      writeNode._handlers.close();
    }
  });

  test('writes raw line protocol string with database override', async () => {
    const { RED, influxModule } = setup();
    const ConfigCtor = RED._types['influxdb3-config'];
    const WriteCtor = RED._types['influxdb3-write'];

    const configNode = new ConfigCtor({
      host: 'https://example.com',
      database: 'metrics',
      name: 'Test',
      credentials: { token: 'token' }
    });

    const writeNode = new WriteCtor({
      influxdb: configNode,
      measurement: '',
      database: ''
    });

    const msg = {
      payload: ' weather,location=lab temperature=18.5 ',
      database: 'override-db'
    };

    const send = jest.fn();
    const done = jest.fn();
    await writeNode._handlers.input(msg, send, done);

    const client = influxModule.__getLastClientInstance();
    expect(client.write).toHaveBeenCalledWith('weather,location=lab temperature=18.5', 'override-db');
    expect(send).toHaveBeenCalledWith(msg);
    expect(done).toHaveBeenCalled();

    if (writeNode._handlers.close) {
      writeNode._handlers.close();
    }
  });
});

// Helper to create a write node for addFieldToPoint / buildLineProtocol tests
function createWriteNode() {
  const { RED, influxModule } = setup();
  const ConfigCtor = RED._types['influxdb3-config'];
  const WriteCtor = RED._types['influxdb3-write'];

  const configNode = new ConfigCtor({
    host: 'https://example.com',
    database: 'metrics',
    name: 'Test',
    credentials: { token: 'token' }
  });

  const writeNode = new WriteCtor({
    influxdb: configNode,
    measurement: 'test_measurement',
    database: ''
  });

  return { RED, influxModule, configNode, writeNode };
}

describe('addFieldToPoint – field type handling', () => {
  test('float fields by default for numbers', async () => {
    const { influxModule, writeNode } = createWriteNode();
    const msg = {
      measurement: 'sensor',
      payload: { fields: { temperature: 21.5, humidity: 60 } }
    };
    const send = jest.fn();
    const done = jest.fn();
    await writeNode._handlers.input(msg, send, done);

    const point = influxModule.__getLastPoint();
    expect(point.floatFields.temperature).toBe(21.5);
    expect(point.floatFields.humidity).toBe(60);
    expect(done).toHaveBeenCalled();
    expect(done.mock.calls[0][0]).toBeUndefined();
  });

  test('integer fields when listed in msg.payload.integers', async () => {
    const { influxModule, writeNode } = createWriteNode();
    const msg = {
      measurement: 'sensor',
      payload: {
        fields: { count: 42, temperature: 21.5 },
        integers: ['count']
      }
    };
    const send = jest.fn();
    const done = jest.fn();
    await writeNode._handlers.input(msg, send, done);

    const point = influxModule.__getLastPoint();
    expect(point.integerFields.count).toBe(42);
    expect(point.floatFields.temperature).toBe(21.5);
  });

  test('integer suffix string "42i" is parsed as integer', async () => {
    const { influxModule, writeNode } = createWriteNode();
    const msg = {
      measurement: 'sensor',
      payload: { fields: { count: '42i' } }
    };
    const send = jest.fn();
    const done = jest.fn();
    await writeNode._handlers.input(msg, send, done);

    const point = influxModule.__getLastPoint();
    expect(point.integerFields.count).toBe(42);
  });

  test('negative integer suffix string "-7i" is parsed as integer', async () => {
    const { influxModule, writeNode } = createWriteNode();
    const msg = {
      measurement: 'sensor',
      payload: { fields: { offset: '-7i' } }
    };
    const send = jest.fn();
    const done = jest.fn();
    await writeNode._handlers.input(msg, send, done);

    const point = influxModule.__getLastPoint();
    expect(point.integerFields.offset).toBe(-7);
  });

  test('regular strings are set as string fields', async () => {
    const { influxModule, writeNode } = createWriteNode();
    const msg = {
      measurement: 'sensor',
      payload: { fields: { status: 'ok' } }
    };
    const send = jest.fn();
    const done = jest.fn();
    await writeNode._handlers.input(msg, send, done);

    const point = influxModule.__getLastPoint();
    expect(point.stringFields.status).toBe('ok');
  });

  test('boolean fields are set correctly', async () => {
    const { influxModule, writeNode } = createWriteNode();
    const msg = {
      measurement: 'sensor',
      payload: { fields: { active: true, disabled: false } }
    };
    const send = jest.fn();
    const done = jest.fn();
    await writeNode._handlers.input(msg, send, done);

    const point = influxModule.__getLastPoint();
    expect(point.booleanFields.active).toBe(true);
    expect(point.booleanFields.disabled).toBe(false);
  });

  test('non-integer float is truncated with warning when marked as integer', async () => {
    const { influxModule, writeNode } = createWriteNode();
    const msg = {
      measurement: 'sensor',
      payload: {
        fields: { value: 3.7 },
        integers: ['value']
      }
    };
    const send = jest.fn();
    const done = jest.fn();
    await writeNode._handlers.input(msg, send, done);

    const point = influxModule.__getLastPoint();
    expect(point.integerFields.value).toBe(3);
    expect(writeNode.warn).toHaveBeenCalledWith(
      expect.stringContaining("marked as integer but value is 3.7")
    );
  });
});

describe('addFieldToPoint – enhanced error messages (issue #16)', () => {
  test('object field value produces detailed warning with type and value', async () => {
    const { writeNode } = createWriteNode();
    const msg = {
      measurement: 'sensor',
      payload: {
        fields: {
          good: 42,
          nested: { a: 1, b: 2 }
        }
      }
    };
    const send = jest.fn();
    const done = jest.fn();
    await writeNode._handlers.input(msg, send, done);

    expect(writeNode.warn).toHaveBeenCalledWith(
      expect.stringContaining("Skipping field 'nested': unsupported type 'object' (Object)")
    );
    expect(writeNode.warn).toHaveBeenCalledWith(
      expect.stringContaining('Actual value: {"a":1,"b":2}')
    );
    expect(writeNode.warn).toHaveBeenCalledWith(
      expect.stringContaining("must be a number, string, or boolean")
    );
    // Should still succeed for the valid field
    expect(send).toHaveBeenCalled();
    expect(done).toHaveBeenCalled();
  });

  test('array field value shows Array type name in warning', async () => {
    const { writeNode } = createWriteNode();
    const msg = {
      measurement: 'sensor',
      payload: {
        fields: {
          good: 1,
          values: [1, 2, 3]
        }
      }
    };
    const send = jest.fn();
    const done = jest.fn();
    await writeNode._handlers.input(msg, send, done);

    expect(writeNode.warn).toHaveBeenCalledWith(
      expect.stringContaining("unsupported type 'object' (Array)")
    );
    expect(writeNode.warn).toHaveBeenCalledWith(
      expect.stringContaining('Actual value: [1,2,3]')
    );
  });

  test('null field value produces clear warning', async () => {
    const { writeNode } = createWriteNode();
    const msg = {
      measurement: 'sensor',
      payload: {
        fields: {
          good: 1,
          broken: null
        }
      }
    };
    const send = jest.fn();
    const done = jest.fn();
    await writeNode._handlers.input(msg, send, done);

    expect(writeNode.warn).toHaveBeenCalledWith(
      expect.stringContaining("Skipping field 'broken': value is null")
    );
  });

  test('undefined field value produces clear warning', async () => {
    const { writeNode } = createWriteNode();
    const msg = {
      measurement: 'sensor',
      payload: {
        fields: {
          good: 1,
          missing: undefined
        }
      }
    };
    const send = jest.fn();
    const done = jest.fn();
    await writeNode._handlers.input(msg, send, done);

    expect(writeNode.warn).toHaveBeenCalledWith(
      expect.stringContaining("Skipping field 'missing': value is undefined")
    );
  });

  test('NaN field value is skipped with warning', async () => {
    const { writeNode } = createWriteNode();
    const msg = {
      measurement: 'sensor',
      payload: {
        fields: {
          good: 1,
          bad: NaN
        }
      }
    };
    const send = jest.fn();
    const done = jest.fn();
    await writeNode._handlers.input(msg, send, done);

    expect(writeNode.warn).toHaveBeenCalledWith(
      expect.stringContaining("Skipping field 'bad': numeric value is NaN (not finite)")
    );
  });

  test('Infinity field value is skipped with warning', async () => {
    const { writeNode } = createWriteNode();
    const msg = {
      measurement: 'sensor',
      payload: {
        fields: {
          good: 1,
          bad: Infinity
        }
      }
    };
    const send = jest.fn();
    const done = jest.fn();
    await writeNode._handlers.input(msg, send, done);

    expect(writeNode.warn).toHaveBeenCalledWith(
      expect.stringContaining("Skipping field 'bad': numeric value is Infinity (not finite)")
    );
  });

  test('warning includes measurement name as context', async () => {
    const { writeNode } = createWriteNode();
    const msg = {
      measurement: 'my_sensor',
      payload: {
        fields: {
          good: 1,
          broken: { nested: true }
        }
      }
    };
    const send = jest.fn();
    const done = jest.fn();
    await writeNode._handlers.input(msg, send, done);

    expect(writeNode.warn).toHaveBeenCalledWith(
      expect.stringContaining("(measurement: 'my_sensor')")
    );
  });

  test('all fields skipped produces error with payload dump', async () => {
    const { writeNode } = createWriteNode();
    const msg = {
      measurement: 'sensor',
      payload: {
        fields: {
          bad1: null,
          bad2: { nested: true }
        }
      }
    };
    const send = jest.fn();
    const done = jest.fn();
    await writeNode._handlers.input(msg, send, done);

    // done is called with an error when no valid fields remain
    expect(done).toHaveBeenCalledWith(expect.any(Error));
    expect(done.mock.calls[0][0].message).toContain('No valid fields to write');
  });
});

describe('buildLineProtocol – simplified payload format', () => {
  test('non-reserved keys are used as fields', async () => {
    const { influxModule, writeNode } = createWriteNode();
    const msg = {
      measurement: 'sensor',
      payload: {
        temperature: 21.5,
        humidity: 60,
        tags: { location: 'lab' }
      }
    };
    const send = jest.fn();
    const done = jest.fn();
    await writeNode._handlers.input(msg, send, done);

    const point = influxModule.__getLastPoint();
    expect(point.floatFields.temperature).toBe(21.5);
    expect(point.floatFields.humidity).toBe(60);
    expect(point.tags.location).toBe('lab');
    // Reserved keys should NOT appear as fields
    expect(point.floatFields.tags).toBeUndefined();
    expect(point.stringFields.tags).toBeUndefined();
  });

  test('reserved keys (tags, timestamp, integers, fields) are excluded from fields', async () => {
    const { influxModule, writeNode } = createWriteNode();
    const msg = {
      measurement: 'sensor',
      payload: {
        value: 42,
        tags: { location: 'lab' },
        timestamp: 1700000000000,
        integers: ['value']
      }
    };
    const send = jest.fn();
    const done = jest.fn();
    await writeNode._handlers.input(msg, send, done);

    const point = influxModule.__getLastPoint();
    expect(point.integerFields.value).toBe(42);
    // None of the reserved keys should appear as field entries
    expect(point.floatFields.tags).toBeUndefined();
    expect(point.floatFields.timestamp).toBeUndefined();
    expect(point.floatFields.integers).toBeUndefined();
    expect(point.floatFields.fields).toBeUndefined();
  });
});

describe('buildLineProtocol – timestamp handling', () => {
  test('numeric timestamp from msg.payload.timestamp', async () => {
    const { influxModule, writeNode } = createWriteNode();
    const msg = {
      measurement: 'sensor',
      payload: {
        fields: { value: 1 },
        timestamp: 1700000000000
      }
    };
    const send = jest.fn();
    const done = jest.fn();
    await writeNode._handlers.input(msg, send, done);

    const point = influxModule.__getLastPoint();
    expect(point.timestamp).toEqual(new Date(1700000000000));
  });

  test('fallback to msg.timestamp when payload.timestamp is absent', async () => {
    const { influxModule, writeNode } = createWriteNode();
    const msg = {
      measurement: 'sensor',
      timestamp: 1700000000000,
      payload: {
        fields: { value: 1 }
      }
    };
    const send = jest.fn();
    const done = jest.fn();
    await writeNode._handlers.input(msg, send, done);

    const point = influxModule.__getLastPoint();
    expect(point.timestamp).toEqual(new Date(1700000000000));
  });

  test('Date object timestamp is used directly', async () => {
    const { influxModule, writeNode } = createWriteNode();
    const date = new Date('2025-01-01T00:00:00Z');
    const msg = {
      measurement: 'sensor',
      payload: {
        fields: { value: 1 },
        timestamp: date
      }
    };
    const send = jest.fn();
    const done = jest.fn();
    await writeNode._handlers.input(msg, send, done);

    const point = influxModule.__getLastPoint();
    expect(point.timestamp).toEqual(date);
  });

  test('invalid timestamp string produces warning', async () => {
    const { writeNode } = createWriteNode();
    const msg = {
      measurement: 'sensor',
      payload: {
        fields: { value: 1 },
        timestamp: 'not-a-date'
      }
    };
    const send = jest.fn();
    const done = jest.fn();
    await writeNode._handlers.input(msg, send, done);

    expect(writeNode.warn).toHaveBeenCalledWith(
      expect.stringContaining("Invalid timestamp string: 'not-a-date'")
    );
  });
});

describe('buildLineProtocol – error cases', () => {
  test('missing measurement produces error', async () => {
    const { RED } = setup();
    const ConfigCtor = RED._types['influxdb3-config'];
    const WriteCtor = RED._types['influxdb3-write'];

    const configNode = new ConfigCtor({
      host: 'https://example.com',
      database: 'metrics',
      name: 'Test',
      credentials: { token: 'token' }
    });

    // No measurement on node
    const writeNode = new WriteCtor({
      influxdb: configNode,
      measurement: '',
      database: ''
    });

    const msg = {
      // No measurement on msg either
      payload: { fields: { value: 1 } }
    };
    const send = jest.fn();
    const done = jest.fn();
    await writeNode._handlers.input(msg, send, done);

    expect(done).toHaveBeenCalledWith(expect.any(Error));
    expect(done.mock.calls[0][0].message).toContain('Measurement not specified');
  });

  test('empty line protocol string produces error', async () => {
    const { RED } = setup();
    const ConfigCtor = RED._types['influxdb3-config'];
    const WriteCtor = RED._types['influxdb3-write'];

    const configNode = new ConfigCtor({
      host: 'https://example.com',
      database: 'metrics',
      name: 'Test',
      credentials: { token: 'token' }
    });

    const writeNode = new WriteCtor({
      influxdb: configNode,
      measurement: '',
      database: ''
    });

    const msg = {
      payload: '   '
    };
    const send = jest.fn();
    const done = jest.fn();
    await writeNode._handlers.input(msg, send, done);

    expect(done).toHaveBeenCalledWith(expect.any(Error));
    expect(done.mock.calls[0][0].message).toContain('Line protocol string is empty');
  });

  test('invalid payload type (array) produces error', async () => {
    const { writeNode } = createWriteNode();
    const msg = {
      payload: [1, 2, 3]
    };
    const send = jest.fn();
    const done = jest.fn();
    await writeNode._handlers.input(msg, send, done);

    expect(done).toHaveBeenCalledWith(expect.any(Error));
    expect(done.mock.calls[0][0].message).toContain('Invalid payload format');
  });
});

describe('InfluxDB v3 config node – credentials warning', () => {
  test('logs warning when credentials object is undefined', () => {
    const RED = buildRED();

    // Override createNode to NOT set credentials
    RED.nodes.createNode = function(node, _config) {
      node.status = jest.fn();
      node.error = jest.fn();
      node.warn = jest.fn();
      node.send = jest.fn();
      node.on = jest.fn((event, handler) => {
        node._handlers = node._handlers || {};
        node._handlers[event] = handler;
      });
      // Deliberately NOT setting node.credentials
    };

    require('../influxdb3.js')(RED);
    const ConfigCtor = RED._types['influxdb3-config'];

    const configNode = new ConfigCtor({
      host: 'https://example.com',
      database: 'metrics',
      name: 'Test'
    });

    expect(RED.log.warn).toHaveBeenCalledWith(
      'InfluxDB v3 config: credentials object is undefined'
    );
    expect(configNode.token).toBeUndefined();
  });
});

