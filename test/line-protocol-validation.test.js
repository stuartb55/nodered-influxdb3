/**
 * Tests for line protocol string validation.
 * Imports the real validateLineProtocol from the shipping code so the test
 * cannot drift from the implementation.
 */

const { validateLineProtocol } = require('../lib/line-protocol');

describe('Line protocol string validation', () => {
    test('valid line protocol returns null', () => {
        expect(validateLineProtocol('weather,location=us-midwest temperature=82 1465839830100400200')).toBeNull();
    });

    test('valid line protocol without timestamp returns null', () => {
        expect(validateLineProtocol('weather,location=us-midwest temperature=82')).toBeNull();
    });

    test('valid line protocol without tags returns null', () => {
        expect(validateLineProtocol('weather temperature=82')).toBeNull();
    });

    test('valid line protocol with multiple fields returns null', () => {
        expect(validateLineProtocol('weather temperature=82,humidity=71')).toBeNull();
    });

    test('detects JSON object string', () => {
        const input = '{"fields":{"used":12.0},"tags":{"location":"office"}}';
        const result = validateLineProtocol(input);
        expect(result).toContain('JSON/object string');
        expect(result).toContain('not line protocol');
        expect(result).toContain('JSON parse node');
    });

    test('detects JS object notation string (unquoted keys)', () => {
        const input = '{fields:{used:12.0,path:root},tags:{location:office,node:grafana2}}';
        const result = validateLineProtocol(input);
        expect(result).toContain('JSON/object string');
    });

    test('detects JSON array string', () => {
        const input = '[{"measurement":"test","fields":{"value":1}}]';
        const result = validateLineProtocol(input);
        expect(result).toContain('JSON/object string');
    });

    test('detects string with no space (not line protocol)', () => {
        const result = validateLineProtocol('justameasurement');
        expect(result).toContain('does not appear to be valid line protocol');
    });

    test('detects string with no equals sign (not line protocol)', () => {
        const result = validateLineProtocol('measurement nofields');
        expect(result).toContain('does not appear to be valid line protocol');
    });

    test('truncates long strings in error message', () => {
        const longJson = '{' + '"a":1,'.repeat(50) + '"b":2}';
        const result = validateLineProtocol(longJson);
        expect(result).toContain('...');
    });
});
