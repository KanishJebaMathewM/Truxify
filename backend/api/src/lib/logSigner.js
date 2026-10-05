/**
 * @fileoverview HMAC signing utilities for audit log batches.
 * Ensures log immutability and tamper detection.
 */

import crypto from 'crypto';
import { EVENT_SEVERITY } from './auditEventTypes.js';

const HMAC_ALGORITHM = 'sha256';
const DEFAULT_EVENT_SEVERITY = 'info';

/**
 * Signs a batch of log entries using a rotating HMAC key.
 * @param {object[]} logs - Array of log objects.
 * @param {string} secret - The signing secret.
 * @returns {string} Hex-encoded HMAC signature.
 */
export function signLogBatch(logs, secret) {
    if (!logs || logs.length === 0 || !secret) return '';

    // Create a deterministic string representation of the batch
    const payload = logs.map(log => {
        return `${log.id}|${log.timestamp}|${log.event_type}|${log.user_id}`;
    }).join('\n');

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
 * Resolves the SIEM severity for an audit event type.
 * Unknown or missing types fall back to info so queueing never fails.
 * @param {string} eventType
 * @returns {string}
 */
export function getEventSeverity(eventType) {
    if (typeof eventType !== 'string' || eventType.length === 0) {
        return DEFAULT_EVENT_SEVERITY;
    }
    return EVENT_SEVERITY[eventType] ?? DEFAULT_EVENT_SEVERITY;
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
