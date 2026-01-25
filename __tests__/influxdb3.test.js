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
  mockLastClientOptions = undefined;
  mockLastClientInstance = undefined;
  mockLastPoint = undefined;
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
