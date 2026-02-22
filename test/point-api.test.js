const { Point } = require('@influxdata/influxdb3-client');

describe('@influxdata/influxdb3-client v2.x Point API', () => {
    test('Point.setField exists and is a function', () => {
        const point = new Point('test');
        expect(typeof point.setField).toBe('function');
    });

    test('Point.setField accepts (name, value) for float', () => {
        const point = new Point('test');
        point.setField('temp', 23.5);
        const lp = point.toLineProtocol();
        expect(lp).toContain('temp=23.5');
    });

    test('Point.setField accepts (name, value, "integer") for integer', () => {
        const point = new Point('test');
        point.setField('count', 42, 'integer');
        const lp = point.toLineProtocol();
        expect(lp).toContain('count=42i');
    });

    test('Point.setField accepts (name, value) for string', () => {
        const point = new Point('test');
        point.setField('status', 'ok');
        const lp = point.toLineProtocol();
        expect(lp).toContain('status="ok"');
    });

    test('Point.setField accepts (name, value) for boolean', () => {
        const point = new Point('test');
        point.setField('active', true);
        const lp = point.toLineProtocol();
        // Library serializes booleans as T/F in line protocol
        expect(lp).toContain('active=T');
    });

    test('Point.setTag exists and is a function', () => {
        const point = new Point('test');
        expect(typeof point.setTag).toBe('function');
    });

    test('Point.setTimestamp exists and is a function', () => {
        const point = new Point('test');
        expect(typeof point.setTimestamp).toBe('function');
    });

    test('type-specific methods exist alongside generic setField', () => {
        const point = new Point('test');
        expect(typeof point.setIntegerField).toBe('function');
        expect(typeof point.setFloatField).toBe('function');
        expect(typeof point.setStringField).toBe('function');
        expect(typeof point.setBooleanField).toBe('function');
    });
});

