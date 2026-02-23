/**
 * Tests for line protocol string validation.
 * Tests the actual validateLineProtocol function exported from influxdb3.js.
 */

const { validateLineProtocol } = require('../influxdb3')._test;

describe('Line protocol string validation', () => {

    // ── Valid line protocol (should return null — no error) ──

    describe('accepts valid line protocol', () => {
        test('with tags and timestamp', () => {
            expect(validateLineProtocol('weather,location=us-midwest temperature=82 1465839830100400200')).toBeNull();
        });

        test('without timestamp', () => {
            expect(validateLineProtocol('weather,location=us-midwest temperature=82')).toBeNull();
        });

        test('without tags', () => {
            expect(validateLineProtocol('weather temperature=82')).toBeNull();
        });

        test('with multiple fields', () => {
            expect(validateLineProtocol('weather temperature=82,humidity=71')).toBeNull();
        });

        test('with multiple tags and fields', () => {
            expect(validateLineProtocol('weather,location=us-midwest,season=summer temperature=82,humidity=71 1465839830100400200')).toBeNull();
        });

        test('with string field value', () => {
            expect(validateLineProtocol('weather,location=us-midwest description="sunny day" 1465839830100400200')).toBeNull();
        });

        test('with boolean field value', () => {
            expect(validateLineProtocol('weather,location=us-midwest raining=false 1465839830100400200')).toBeNull();
        });

        test('with integer field value', () => {
            expect(validateLineProtocol('weather,location=us-midwest count=5i 1465839830100400200')).toBeNull();
        });

        test('with negative field value', () => {
            expect(validateLineProtocol('weather temperature=-10.5')).toBeNull();
        });

        test('with escaped spaces in measurement', () => {
            expect(validateLineProtocol('weather\\ station temperature=82')).toBeNull();
        });

        test('with escaped commas in tag value', () => {
            expect(validateLineProtocol('weather,location=us\\,midwest temperature=82')).toBeNull();
        });

        test('with escaped equals in tag value', () => {
            expect(validateLineProtocol('weather,equation=a\\=b temperature=82')).toBeNull();
        });

        test('with special characters in field key', () => {
            expect(validateLineProtocol('weather temp_celsius=82')).toBeNull();
        });

        test('with nanosecond timestamp', () => {
            expect(validateLineProtocol('cpu,host=server01 usage=0.64 1465839830100400200')).toBeNull();
        });

        test('with millisecond timestamp', () => {
            expect(validateLineProtocol('cpu,host=server01 usage=0.64 1465839830100')).toBeNull();
        });
    });

    // ── User bug report payloads (must be detected as invalid) ──

    describe('detects user-reported invalid payloads', () => {
        test('exact tcpdump payload from GitHub issue', () => {
            const input = '{fields:{used:12.0,path:root},tags:{location:office,node:grafana2}}';
            const result = validateLineProtocol(input);
            expect(result).not.toBeNull();
            expect(result).toContain('JavaScript object converted to string');
            expect(result).toContain('.toString()');
        });

        test('original user payload as JSON string', () => {
            const input = JSON.stringify({
                fields: { temp_windchill: 0.31, daylight: 1, wattage_average: 30.6 },
                tags: { type: 'calculated', room: 'outside', device: 'ROOM' },
                timestamp: 1771439907217
            });
            const result = validateLineProtocol(input);
            expect(result).not.toBeNull();
            expect(result).toContain('JSON/object string');
        });
    });

    // ── .toString() coercion detection ──

    describe('detects .toString() coercion', () => {
        test('[object Object]', () => {
            const result = validateLineProtocol('[object Object]');
            expect(result).toContain('.toString()');
            expect(result).toContain('actual object');
        });

        test('[object Array]', () => {
            const result = validateLineProtocol('[object Array]');
            expect(result).toContain('.toString()');
        });

        test('[object Date]', () => {
            const result = validateLineProtocol('[object Date]');
            expect(result).toContain('.toString()');
        });

        test('[object Map]', () => {
            const result = validateLineProtocol('[object Map]');
            expect(result).toContain('.toString()');
        });
    });

    // ── JS object notation detection ──

    describe('detects JS object notation strings', () => {
        test('simple unquoted keys', () => {
            const result = validateLineProtocol('{name:test,value:123}');
            expect(result).toContain('JavaScript object converted to string');
        });

        test('nested objects', () => {
            const result = validateLineProtocol('{a:{b:1},c:{d:2}}');
            expect(result).toContain('JavaScript object converted to string');
        });

        test('underscore-prefixed key', () => {
            const result = validateLineProtocol('{_id:123,name:test}');
            expect(result).toContain('JavaScript object converted to string');
        });

        test('key with digits', () => {
            const result = validateLineProtocol('{sensor1:23.5,sensor2:24.1}');
            expect(result).toContain('JavaScript object converted to string');
        });

        test('truncates long object notation strings', () => {
            const input = '{' + 'field' + ':1,'.repeat(50) + 'last:1}';
            const result = validateLineProtocol(input);
            expect(result).toContain('...');
        });
    });

    // ── JSON string detection ──

    describe('detects JSON strings', () => {
        test('JSON object with quoted keys', () => {
            const input = '{"fields":{"used":12.0},"tags":{"location":"office"}}';
            const result = validateLineProtocol(input);
            expect(result).toContain('JSON/object string');
            expect(result).toContain('JSON parse node');
        });

        test('JSON array', () => {
            const input = '[{"measurement":"test","fields":{"value":1}}]';
            const result = validateLineProtocol(input);
            expect(result).toContain('JSON/object string');
        });

        test('simple JSON array of numbers', () => {
            const result = validateLineProtocol('[1,2,3]');
            expect(result).toContain('JSON/object string');
        });

        test('empty JSON object', () => {
            const result = validateLineProtocol('{}');
            expect(result).not.toBeNull();
        });

        test('empty JSON array', () => {
            const result = validateLineProtocol('[]');
            expect(result).not.toBeNull();
        });

        test('truncates long JSON strings', () => {
            const longJson = '{' + '"a":1,'.repeat(50) + '"b":2}';
            const result = validateLineProtocol(longJson);
            expect(result).toContain('...');
        });
    });

    // ── Invalid line protocol format ──

    describe('detects invalid line protocol format', () => {
        test('no space (just a word)', () => {
            const result = validateLineProtocol('justameasurement');
            expect(result).toContain('does not appear to be valid line protocol');
        });

        test('space but no equals sign', () => {
            const result = validateLineProtocol('measurement nofields');
            expect(result).toContain('does not appear to be valid line protocol');
        });

        test('equals but no space', () => {
            const result = validateLineProtocol('measurement,tag=val');
            expect(result).toContain('does not appear to be valid line protocol');
        });

        test('random text', () => {
            const result = validateLineProtocol('hello world');
            expect(result).toContain('does not appear to be valid line protocol');
        });

        test('URL string', () => {
            const result = validateLineProtocol('http://localhost:8086');
            expect(result).toContain('does not appear to be valid line protocol');
        });

        test('number as string', () => {
            const result = validateLineProtocol('42');
            expect(result).toContain('does not appear to be valid line protocol');
        });

        test('truncates long invalid strings', () => {
            const longStr = 'a'.repeat(200);
            const result = validateLineProtocol(longStr);
            expect(result).toContain('...');
        });
    });

    // ── Edge cases and regression tests ──

    describe('edge cases', () => {
        test('measurement name starting with { passes lightweight validation (InfluxDB will reject)', () => {
            // Our validator only checks structure, not measurement name validity.
            // {measurement} field=1 has a space and =, so it passes.
            // InfluxDB itself will return an error for invalid measurement names.
            const input = '{measurement} field=1';
            const result = validateLineProtocol(input);
            expect(result).toBeNull();
        });

        test('does not false-positive on measurement with equals in tag', () => {
            expect(validateLineProtocol('cpu,host=server01 value=1')).toBeNull();
        });

        test('does not false-positive on field with special float notation', () => {
            expect(validateLineProtocol('cpu,host=server01 value=1.23e10')).toBeNull();
        });

        test('does not false-positive on multiple lines of line protocol', () => {
            const multiLine = 'cpu,host=a value=1\ncpu,host=b value=2';
            expect(validateLineProtocol(multiLine)).toBeNull();
        });

        test('does not false-positive on line protocol with empty string field', () => {
            expect(validateLineProtocol('test field=""')).toBeNull();
        });

        test('does not false-positive on line protocol with zero value', () => {
            expect(validateLineProtocol('test value=0')).toBeNull();
        });

        test('does not false-positive on line protocol with negative integer', () => {
            expect(validateLineProtocol('test value=-5i')).toBeNull();
        });
    });
});
