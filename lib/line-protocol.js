/**
 * Pure line-protocol helpers, extracted so they can be unit-tested directly
 * (and shared) rather than re-implemented in test files.
 * @module lib/line-protocol
 */

'use strict';

/**
 * Truncate a string for use in error messages.
 * @param {string} str
 * @returns {string}
 */
function preview(str) {
    return str.length > 100 ? str.substring(0, 100) + '...' : str;
}

/**
 * Validate that a string looks like InfluxDB line protocol.
 * Multi-line strings (multiple points separated by newlines) are validated
 * line by line; blank lines are allowed and skipped.
 * Returns null if valid, or an error message string if invalid.
 * @param {string} lp - Trimmed line protocol string
 * @returns {string|null}
 */
function validateLineProtocol(lp) {
    // Detect JSON-like strings (both valid JSON and JS object notation).
    // Checked against the whole string first, because pretty-printed JSON
    // spans multiple lines.
    if (/^\{[\s\S]*}$/.test(lp) || /^\[[\s\S]*]$/.test(lp)) {
        return (
            'The payload appears to be a JSON/object string, not line protocol. ' +
            'If you are sending JSON, ensure msg.payload is a parsed object (not a string). ' +
            'Use a JSON parse node before this node to convert the string to an object. ' +
            `Received string: ${preview(lp)}`
        );
    }

    // Each line must have at least: measurement field=value
    // i.e. at least one space and one '=' in the field set
    const lines = lp.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) {
            continue;
        }
        if (!line.includes(' ') || !line.includes('=')) {
            const where = lines.length > 1 ? `Line ${i + 1} of the payload` : 'The payload string';
            return (
                `${where} does not appear to be valid line protocol. ` +
                'Expected format: measurement[,tag=val] field=val[,field=val] [timestamp]. ' +
                `Received: ${preview(line)}`
            );
        }
    }

    return null;
}

module.exports = { validateLineProtocol };
