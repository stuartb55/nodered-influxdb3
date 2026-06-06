const { Point } = require('@influxdata/influxdb3-client');

/**
 * Pins the real @influxdata/influxdb3-client Point API that influxdb3.js depends on.
 * The node uses the type-specific setters (setFloatField / setIntegerField /
 * setStringField / setBooleanField / setTag / setTimestamp) and toLineProtocol(),
 * so those are what we verify here — if the library changes them, this suite fails.
 */
describe('@influxdata/influxdb3-client v2.x Point API used by influxdb3.js', () => {
    test('setFloatField writes a float field', () => {
        const lp = new Point('test').setFloatField('temp', 23.5).toLineProtocol();
        expect(lp).toContain('temp=23.5');
    });

    test('setFloatField keeps whole numbers as floats (no i suffix)', () => {
        const lp = new Point('test').setFloatField('count', 60).toLineProtocol();
        expect(lp).toContain('count=60');
        expect(lp).not.toContain('count=60i');
    });

    test('setIntegerField writes an integer field with the i suffix', () => {
        const lp = new Point('test').setIntegerField('count', 42).toLineProtocol();
        expect(lp).toContain('count=42i');
    });

    test('setIntegerField supports negative integers', () => {
        const lp = new Point('test').setIntegerField('offset', -7).toLineProtocol();
        expect(lp).toContain('offset=-7i');
    });

    test('setStringField writes a quoted string field', () => {
        const lp = new Point('test').setStringField('status', 'ok').toLineProtocol();
        expect(lp).toContain('status="ok"');
    });

    test('setBooleanField writes a boolean field', () => {
        const lp = new Point('test').setBooleanField('active', true).toLineProtocol();
        // Library serializes booleans as T/F in line protocol
        expect(lp).toContain('active=T');
    });

    test('setTag writes a tag in the measurement,tag=value section', () => {
        const lp = new Point('test')
            .setTag('location', 'room1')
            .setFloatField('value', 1)
            .toLineProtocol();
        expect(lp).toContain('test,location=room1 ');
    });

    test('setTimestamp accepts a Date and appends a nanosecond timestamp', () => {
        const lp = new Point('test')
            .setFloatField('value', 1)
            .setTimestamp(new Date(1700000000000))
            .toLineProtocol();
        // 1700000000000 ms -> 1700000000000000000 ns
        expect(lp).toContain('1700000000000000000');
    });

    test('the setters used by the node are all functions', () => {
        const point = new Point('test');
        expect(typeof point.setFloatField).toBe('function');
        expect(typeof point.setIntegerField).toBe('function');
        expect(typeof point.setStringField).toBe('function');
        expect(typeof point.setBooleanField).toBe('function');
        expect(typeof point.setTag).toBe('function');
        expect(typeof point.setTimestamp).toBe('function');
        expect(typeof point.toLineProtocol).toBe('function');
    });
});
