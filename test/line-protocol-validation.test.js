/**
 * Tests for line protocol string validation.
 * Mirrors the validateLineProtocol logic in influxdb3.js.
 */

// Re-implement the validation logic here to test it in isolation
// (the function is not exported from influxdb3.js)
function validateLineProtocol(lp) {
    if (/^\{[\s\S]*}$/.test(lp) || /^\[[\s\S]*]$/.test(lp)) {
        const preview = lp.length > 100 ? lp.substring(0, 100) + '...' : lp;
        return (
            'The payload appears to be a JSON/object string, not line protocol. ' +
            'If you are sending JSON, ensure msg.payload is a parsed object (not a string). ' +
            'Use a JSON parse node before this node to convert the string to an object. ' +
            `Received string: ${preview}`
        );
    }

    if (!lp.includes(' ') || !lp.includes('=')) {
        const preview = lp.length > 100 ? lp.substring(0, 100) + '...' : lp;
        return (
            'The payload string does not appear to be valid line protocol. ' +
            'Expected format: measurement[,tag=val] field=val[,field=val] [timestamp]. ' +
            `Received: ${preview}`
        );
    }

    return null;
}

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
