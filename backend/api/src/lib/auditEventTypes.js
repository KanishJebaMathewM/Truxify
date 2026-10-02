/**
 * @fileoverview Definitions for all auditable events in the Truxify platform.
 * Centralizes event names and required context fields for compliance.
 */

export const AUDIT_EVENTS = {
    // Authentication & Authorization
    AUTH_LOGIN_SUCCESS: 'auth.login.success',
    AUTH_LOGIN_FAILURE: 'auth.login.failure',
    AUTH_TOKEN_REFRESH: 'auth.token.refresh',
    AUTH_LOGOUT: 'auth.logout',
    AUTH_ROLE_CHANGE: 'auth.role.change',

    // Order Lifecycle
    ORDER_CREATED: 'order.created',
    ORDER_UPDATED: 'order.updated',
    ORDER_STATUS_CHANGE: 'order.status_change',
    ORDER_CANCELLED: 'order.cancelled',
    ORDER_ASSIGNED: 'order.assigned',

    // Financial & Escrow
    ESCROW_FUNDED: 'escrow.funded',
    ESCROW_RELEASED: 'escrow.released',
    ESCROW_REFUNDED: 'escrow.refunded',
    ESCROW_DISPUTED: 'escrow.disputed',
    PAYMENT_PROCESSED: 'payment.processed',
    PAYMENT_FAILED: 'payment.failed',

    // Bidding
    BID_PLACED: 'bid.placed',
    BID_ACCEPTED: 'bid.accepted',
    BID_REJECTED: 'bid.rejected',
    BID_WITHDRAWN: 'bid.withdrawn',

    // User & Profile
    PROFILE_UPDATED: 'profile.updated',
    DOCUMENT_UPLOADED: 'document.uploaded',
    DOCUMENT_VERIFIED: 'document.verified',
    DOCUMENT_REJECTED: 'document.rejected',

    // System & Admin
    ADMIN_USER_BANNED: 'admin.user.banned',
    ADMIN_USER_UNBANNED: 'admin.user.unbanned',
    ADMIN_SETTINGS_CHANGED: 'admin.settings.changed',
    SYSTEM_ERROR: 'system.error',
};

/**
 * Maps event types to their severity levels for SIEM routing.
 */
export const EVENT_SEVERITY = {
    [AUDIT_EVENTS.AUTH_LOGIN_FAILURE]: 'warning',
    [AUDIT_EVENTS.AUTH_ROLE_CHANGE]: 'critical',
    [AUDIT_EVENTS.ESCROW_FUNDED]: 'high',
    [AUDIT_EVENTS.ESCROW_RELEASED]: 'high',
    [AUDIT_EVENTS.ESCROW_REFUNDED]: 'high',
    [AUDIT_EVENTS.ESCROW_DISPUTED]: 'critical',
    [AUDIT_EVENTS.PAYMENT_FAILED]: 'high',
    [AUDIT_EVENTS.ADMIN_USER_BANNED]: 'critical',
    [AUDIT_EVENTS.SYSTEM_ERROR]: 'error',
};

/**
 * Returns the default severity for an event type.
 * @param {string} eventType 
 * @returns {string}
 */
export function getEventSeverity(eventType) {
    return EVENT_SEVERITY[eventType] || 'info';
}
