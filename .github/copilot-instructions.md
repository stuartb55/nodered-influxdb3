# Copilot instructions for this repo

## Project overview
- This is a Node-RED contrib package that adds two nodes: a config node and a write node for InfluxDB v3.
- Runtime logic lives in `influxdb3.js` (Node-RED node registration and message handling). Editor UI + help text live in `influxdb3.html`.
- Node-RED metadata is defined in `package.json` under `node-red.nodes` (maps `influxdb3` to `influxdb3.js`).

## Architecture & data flow
- The config node (`influxdb3-config`) stores host/database/token (token is credential-only). It lazily builds an `InfluxDBClient` via `getClient()` and normalizes hosts with a trailing `/` (`normalizeHost` in `influxdb3.js`).
- The write node (`influxdb3-write`) accepts `msg.payload` as either line protocol string or an object and converts it to line protocol using `Point` from `@influxdata/influxdb3-client`.
- For object payloads, tags are read from `msg.payload.tags`; fields are either `msg.payload.fields` or “all non-reserved keys” (reserved keys: `tags`, `timestamp`, `integers`, `fields`). See `addFieldToPoint` in `influxdb3.js`.
- Numbers are written as **float fields by default**; integers only when explicitly declared via `msg.payload.integers` or a string suffix like `"42i"` (handled in `addFieldToPoint`).
- Timestamps come from `msg.payload.timestamp` or fallback to `msg.timestamp`; status shows `written` briefly or `error` on failure.

## Integration points
- External dependency: `@influxdata/influxdb3-client` (`InfluxDBClient` + `Point` in `influxdb3.js`).
- Node-RED stores the token as a credential in the config node (`credentials.token`).
- Example flows live in `examples/basic-flow.json` and `examples/mqtt-to-influx.json`.

## Developer workflow
- Install deps with `npm install` (see `README.md`). Link into a local Node-RED user dir via `npm install /path/to/node-red-contrib-influxdb3` and restart Node-RED.
- There are no automated tests yet (`npm test` prints a placeholder message in `package.json`).
- Runtime requirements: Node.js >=14, Node-RED >=3 (see `package.json`).

## Project conventions
- Normalize hosts to include a trailing slash before creating the client.
- Default all numeric fields to floats; use `msg.payload.integers` or `"42i"` strings to force integer fields.
- Message overrides are supported: `msg.measurement`, `msg.database`, and `msg.timestamp`.