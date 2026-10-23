/**
 * @fileoverview Notification type allowlist extracted from the database migration.
 * Resolves Issue #8494: Ensures the allowlist in code matches the DB CHECK constraint.
 * 
 * This is the single source of truth for valid notif_type values.
 * The migration supabase/migrations/20260807000050_widen_notifications_notif_type_check.sql
 * defines the CHECK constraint that enforces these values at the DB level.
 */

import logger from '../middleware/logger.js';

/**
 * Valid notification types that can be stored in the notifications table.
 * MUST match the CHECK constraint in the database migration.
 * 
 * @type {Set<string>}
 */
export const ALLOWED_NOTIF_TYPES = new Set([
    'order_update',
    'payment',
    'load_offer',
    'trip_update',
    'document',
    'system',
    'bid_accepted',
    'new_bid',
    'payment_locked',
    'payment_released',
]);

/**
 * FCM-specific notification types that should be pushed to mobile devices.
 * Not all notif_types need FCM push (e.g., 'document' might be email-only).
 */
export const FCM_ENABLED_TYPES = new Set([
    'order_update',
    'payment',
    'load_offer',
    'trip_update',
    'bid_accepted',
    'new_bid',
    'payment_locked',
    'payment_released',
]);

/**
 * Notification types that require immediate delivery (high priority FCM).
 */
export const HIGH_PRIORITY_TYPES = new Set([
    'payment',
    'bid_accepted',
    'new_bid',
    'payment_locked',
    'payment_released',
]);

/**
 * Validates that a notif_type is in the allowlist.
 * 
 * @param {string} notifType - The notification type to validate
 * @returns {{valid: boolean, error?: string}}
 */
export function validateNotifType(notifType) {
    if (!notifType || typeof notifType !== 'string') {
        return { valid: false, error: 'notif_type must be a non-empty string' };
    }

    const normalized = notifType.trim().toLowerCase();

    if (!ALLOWED_NOTIF_TYPES.has(normalized)) {
        logger.warn({
            event: 'INVALID_NOTIF_TYPE',
            notifType: normalized,
            allowedTypes: Array.from(ALLOWED_NOTIF_TYPES),
        }, `Invalid notif_type rejected: ${normalized}`);

        return {
            valid: false,
            error: `Invalid notif_type: "${normalized}". Allowed: ${Array.from(ALLOWED_NOTIF_TYPES).join(', ')}`,
        };
    }

    return { valid: true, normalized };
}

/**
 * Checks if a notif_type should trigger FCM push.
 * @param {string} notifType
 * @returns {boolean}
 */
export function shouldPushFCM(notifType) {
    return FCM_ENABLED_TYPES.has(notifType);
}

/**
 * Checks if a notif_type requires high priority FCM delivery.
 * @param {string} notifType
 * @returns {boolean}
 */
export function isHighPriority(notifType) {
    return HIGH_PRIORITY_TYPES.has(notifType);
}
