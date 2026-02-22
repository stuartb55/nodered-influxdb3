const { Point } = require('@influxdata/influxdb3-client');

describe('@influxdata/influxdb3-client Point API contract', () => {
    test('setFloatField writes float', () => {
        const point = new Point('test');
        point.setFloatField('temp', 23.5);
        expect(point.toLineProtocol()).toContain('temp=23.5');
    });

    test('setIntegerField writes integer with i suffix', () => {
        const point = new Point('test');
        point.setIntegerField('count', 42);
        expect(point.toLineProtocol()).toContain('count=42i');
    });

    test('setStringField writes quoted string', () => {
        const point = new Point('test');
        point.setStringField('status', 'ok');
        expect(point.toLineProtocol()).toContain('status="ok"');
    });

    test('setBooleanField writes boolean', () => {
        const point = new Point('test');
        point.setBooleanField('active', true);
        const lp = point.toLineProtocol();
        // Library uses T/F for booleans in line protocol
        expect(lp).toContain('active=T');
    });

    test('setTag adds tag to line protocol', () => {
        const point = new Point('test');
        point.setTag('host', 'server01');
        point.setFloatField('value', 1);
        expect(point.toLineProtocol()).toContain('test,host=server01');
    });

    test('setTimestamp accepts Date', () => {
        const point = new Point('test');
        point.setFloatField('value', 1);
        point.setTimestamp(new Date(1000));
        const lp = point.toLineProtocol();
        expect(lp).toBeDefined();
        expect(lp.trim()).not.toBe('');
    });

    test('multiple fields in single point', () => {
        const point = new Point('test');
        point.setFloatField('temp', 23.5);
        point.setIntegerField('count', 42);
        point.setStringField('status', 'ok');
        const lp = point.toLineProtocol();
        expect(lp).toContain('temp=23.5');
        expect(lp).toContain('count=42i');
        expect(lp).toContain('status="ok"');
    });
});
