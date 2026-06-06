/**
 * Pure line-protocol helpers, extracted so they can be unit-tested directly
 * (and shared) rather than re-implemented in test files.
 * @module lib/line-protocol
 */

'use strict';

/**
 * Validate that a string looks like InfluxDB line protocol.
 * Returns null if valid, or an error message string if invalid.
 * @param {string} lp - Trimmed line protocol string
 * @returns {string|null}
 */
function validateLineProtocol(lp) {
    // Detect JSON-like strings (both valid JSON and JS object notation)
    if (/^\{[\s\S]*}$/.test(lp) || /^\[[\s\S]*]$/.test(lp)) {
        const preview = lp.length > 100 ? lp.substring(0, 100) + '...' : lp;
        return (
            'The payload appears to be a JSON/object string, not line protocol. ' +
            'If you are sending JSON, ensure msg.payload is a parsed object (not a string). ' +
            'Use a JSON parse node before this node to convert the string to an object. ' +
            `Received string: ${preview}`
        );
    }

    // Line protocol must have at least: measurement field=value
    // i.e. at least one space and one '=' in the field set
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

module.exports = { validateLineProtocol };
