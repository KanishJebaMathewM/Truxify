/**
 * @fileoverview Express middleware for automatic audit logging.
 * Wraps route handlers to capture before/after state and context.
 */

import { queueAuditLog } from '../services/auditService.js';
import { redactSensitiveFields } from '../lib/logSigner.js';
import logger from '../middleware/logger.js';

/**
 * Middleware factory that logs state changes for a specific resource.
 * 
 * @param {object} options
 * @param {string} options.eventType - The audit event type
 * @param {Function} options.getBeforeState - Async function to fetch state before handler
 * @param {Function} options.getAfterState - Async function to fetch state after handler
 * @param {string[]} options.redactFields - Fields to hash before logging
 * @returns {Function} Express middleware
 */
export function auditResourceChange(options) {
    const {
        eventType,
        getBeforeState,
        getAfterState,
        redactFields = ['password', 'token', 'secret', 'apiKey']
    } = options;

    return async (req, res, next) => {
        let beforeState = null;

        // Capture before state if getter provided
        if (getBeforeState) {
            try {
                beforeState = await getBeforeState(req);
                if (beforeState) {
                    beforeState = redactSensitiveFields(beforeState, redactFields);
                }
            } catch (err) {
                logger.warn({ err }, 'Failed to capture before state for audit');
            }
        }

        // Intercept res.json to capture after state and log
        const originalJson = res.json.bind(res);

        res.json = function (body) {
            // Only log on successful mutations (2xx status)
            if (res.statusCode >= 200 && res.statusCode < 300) {
                const afterState = body ? redactSensitiveFields(body, redactFields) : null;

                // Fire and forget audit log
                queueAuditLog({
                    eventType,
                    userId: req.user?.id,
                    userRole: req.user?.role,
                    ipAddress: req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress,
                    requestId: req.requestId || req.id,
                    beforeState,
                    afterState,
                    metadata: {
                        method: req.method,
                        path: req.originalUrl || req.url,
                        userAgent: req.headers['user-agent']
                    }
                });
            }

            return originalJson(body);
        };

        next();
    };
}

/**
 * Simple middleware to log specific actions without before/after state.
 * 
 * @param {string} eventType 
 * @param {Function} getMetadata - Optional function to extract metadata from req
 * @returns {Function}
 */
export function auditAction(eventType, getMetadata = null) {
    return (req, res, next) => {
        const originalJson = res.json.bind(res);

        res.json = function (body) {
            if (res.statusCode >= 200 && res.statusCode < 300) {
                const metadata = getMetadata ? getMetadata(req, body) : {};

                queueAuditLog({
                    eventType,
                    userId: req.user?.id,
                    userRole: req.user?.role,
                    ipAddress: req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress,
                    requestId: req.requestId || req.id,
                    metadata: {
                        ...metadata,
                        method: req.method,
                        path: req.originalUrl || req.url
                    }
                });
            }

            return originalJson(body);
        };

        next();
    };
}

/**
 * Global error audit logger.
 * Logs 4xx and 5xx responses as security/system events.
 */
export function auditErrors(err, req, res, next) {
    if (res.statusCode >= 400) {
        queueAuditLog({
            eventType: res.statusCode >= 500 ? 'system.error' : 'auth.login.failure',
            userId: req.user?.id || 'anonymous',
            userRole: req.user?.role || 'anonymous',
            ipAddress: req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress,
            requestId: req.requestId || req.id,
            metadata: {
                statusCode: res.statusCode,
                errorMessage: err?.message || 'Unknown error',
                method: req.method,
                path: req.originalUrl || req.url
            }
        });
    }

    next(err);
}
