/**
 * @fileoverview HMAC signing utilities for audit log batches.
 * Ensures log immutability and tamper detection.
 */

import crypto from 'crypto';

const HMAC_ALGORITHM = 'sha256';
const HMAC_HEX_LENGTH = 64;

/**
 * Build a deterministic representation of every field in an audit record.
 *
 * Signing only id/timestamp/event_type/user_id leaves the action, resource,
 * details, IP address, and outcome unauthenticated. An attacker with database
 * access could rewrite those fields while preserving a valid signature.
 * Object keys are sorted so signatures do not depend on JSON insertion order.
 *
 * @param {unknown} value
 * @returns {string}
 */
function canonicalize(value) {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(canonicalize).join(',')}]`;
    }
    const keys = Object.keys(value)
        .filter((key) => key !== 'signature')
        .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}

/**
 * Signs a batch of log entries using a rotating HMAC key.
 * @param {object[]} logs - Array of log objects.
 * @param {string} secret - The signing secret.
 * @returns {string} Hex-encoded HMAC signature.
 */
export function signLogBatch(logs, secret) {
    if (!logs || logs.length === 0 || !secret) return '';

    // Sign the complete record, not only the routing metadata.
    const payload = logs.map(canonicalize).join('\n');

    return crypto
        .createHmac(HMAC_ALGORITHM, secret)
        .update(payload)
        .digest('hex');
}

/**
 * Verifies a batch signature.
 * @param {object[]} logs 
 * @param {string} signature 
 * @param {string} secret 
 * @returns {boolean}
 */
export function verifyLogBatch(logs, signature, secret) {
    if (!signature || !secret) return false;

    const expectedSignature = signLogBatch(logs, secret);
    if (!expectedSignature || !new RegExp(`^[a-f0-9]{${HMAC_HEX_LENGTH}}$`, 'i').test(signature)) {
        return false;
    }

    // Timing-safe comparison
    try {
        return crypto.timingSafeEqual(
            Buffer.from(signature, 'hex'),
            Buffer.from(expectedSignature, 'hex')
        );
    } catch {
        return false;
    }
}

/**
 * Generates a unique, sequential log ID.
 * Uses a combination of timestamp and random bytes for distributed uniqueness.
 * @returns {string}
 */
export function generateLogId() {
    const timestamp = Date.now().toString(36);
    const randomPart = crypto.randomBytes(6).toString('hex');
    return `log_${timestamp}_${randomPart}`;
}

/**
 * Hashes sensitive fields before logging to prevent PII leakage.
 * @param {object} data 
 * @param {string[]} fieldsToHash 
 * @returns {object}
 */
export function redactSensitiveFields(data, fieldsToHash = []) {
    if (!data || typeof data !== 'object') return data;

    const redacted = { ...data };

    for (const field of fieldsToHash) {
        if (redacted[field]) {
            redacted[field] = crypto
                .createHash('sha256')
                .update(String(redacted[field]))
                .digest('hex')
                .substring(0, 16) + '...';
        }
    }

    return redacted;
}
