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

    test('valid multi-line line protocol returns null', () => {
        const input = 'weather,location=a temperature=82\nweather,location=b temperature=79';
        expect(validateLineProtocol(input)).toBeNull();
    });

    test('blank lines between points are allowed', () => {
        const input = 'weather temperature=82\n\nweather temperature=79';
        expect(validateLineProtocol(input)).toBeNull();
    });

    test('invalid line in a multi-line string is reported with its line number', () => {
        const input = 'weather temperature=82\nnot-line-protocol\nweather temperature=79';
        const result = validateLineProtocol(input);
        expect(result).toContain('Line 2');
        expect(result).toContain('does not appear to be valid line protocol');
        expect(result).toContain('not-line-protocol');
    });

    test('single-line error message keeps the original wording', () => {
        const result = validateLineProtocol('justameasurement');
        expect(result).toContain('The payload string does not appear to be valid line protocol');
    });
});
