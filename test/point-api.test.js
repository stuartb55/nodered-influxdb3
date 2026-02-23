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

    // Regression: verify the type-specific methods used by addFieldToPoint
    // produce the expected line protocol output
    describe('type-specific method output (used by addFieldToPoint)', () => {
        test('setFloatField writes float value', () => {
            const point = new Point('test');
            point.setFloatField('temp', 23.5);
            const lp = point.toLineProtocol();
            expect(lp).toContain('temp=23.5');
            expect(lp).not.toContain('temp=23.5i');
        });

        test('setIntegerField writes integer value with i suffix', () => {
            const point = new Point('test');
            point.setIntegerField('count', 42);
            const lp = point.toLineProtocol();
            expect(lp).toContain('count=42i');
        });

        test('setIntegerField with Math.floor of negative float', () => {
            const point = new Point('test');
            point.setIntegerField('val', Math.floor(-2.7));
            const lp = point.toLineProtocol();
            expect(lp).toContain('val=-3i');
        });

        test('setStringField writes quoted string value', () => {
            const point = new Point('test');
            point.setStringField('status', 'ok');
            const lp = point.toLineProtocol();
            expect(lp).toContain('status="ok"');
        });

        test('setStringField with integer suffix string "42i" writes as string', () => {
            // This verifies that if someone calls setStringField with "42i",
            // it's treated as a string, not an integer
            const point = new Point('test');
            point.setStringField('code', '42i');
            const lp = point.toLineProtocol();
            expect(lp).toContain('code="42i"');
        });

        test('setBooleanField writes boolean value', () => {
            const point = new Point('test');
            point.setBooleanField('active', true);
            const lp = point.toLineProtocol();
            // The @influxdata/influxdb3-client library serializes booleans in
            // various formats across versions (T/t/true/TRUE). We use a flexible
            // pattern to avoid breaking tests on library upgrades, since all
            // formats are valid InfluxDB line protocol.
            expect(lp).toMatch(/active=(T|t|true|TRUE)/);
        });

        test('setBooleanField false', () => {
            const point = new Point('test');
            point.setBooleanField('active', false);
            const lp = point.toLineProtocol();
            // See above: flexible pattern for cross-version compatibility
            expect(lp).toMatch(/active=(F|f|false|FALSE)/);
        });

        test('setTag writes tag in measurement line', () => {
            const point = new Point('test');
            point.setTag('host', 'server01');
            point.setFloatField('value', 1);
            const lp = point.toLineProtocol();
            expect(lp).toContain('test,host=server01');
        });

        test('multiple fields and tags combined', () => {
            const point = new Point('weather');
            point.setTag('location', 'office');
            point.setTag('device', 'sensor1');
            point.setFloatField('temperature', 23.5);
            point.setIntegerField('humidity', 71);
            point.setStringField('status', 'ok');
            point.setBooleanField('online', true);
            const lp = point.toLineProtocol();
            expect(lp).toContain('weather,');
            expect(lp).toContain('location=office');
            expect(lp).toContain('device=sensor1');
            expect(lp).toContain('temperature=23.5');
            expect(lp).toContain('humidity=71i');
            expect(lp).toContain('status="ok"');
            expect(lp).toMatch(/online=(T|t|true|TRUE)/);
        });
    });
});
