/**
 * @fileoverview Core audit service for writing and querying immutable logs.
 * Uses an in-memory buffer to batch writes and reduce DB load.
 */

import { supabaseAdmin } from '../config/db.js';
import logger from '../middleware/logger.js';
import { signLogBatch, generateLogId, getEventSeverity } from '../lib/logSigner.js';

const BATCH_SIZE = 50;
const FLUSH_INTERVAL_MS = 2000;
const SIGNING_SECRET = process.env.AUDIT_SIGNING_SECRET || 'truxify-audit-signing-secret';

let logBuffer = [];
let flushTimer = null;

/**
 * Starts the periodic flush timer.
 */
export function startAuditFlushTimer() {
    if (flushTimer) return;

    flushTimer = setInterval(() => {
        if (logBuffer.length > 0) {
            flushAuditLogs().catch(err => {
                logger.error({ err }, 'Periodic audit flush failed');
            });
        }
    }, FLUSH_INTERVAL_MS);

    // Don't keep event loop alive just for audit flushing
    if (flushTimer.unref) flushTimer.unref();
}

/**
 * Stops the flush timer and flushes remaining logs.
 */
export async function stopAuditFlushTimer() {
    if (flushTimer) {
        clearInterval(flushTimer);
        flushTimer = null;
    }
    if (logBuffer.length > 0) {
        await flushAuditLogs();
    }
}

/**
 * Queues an audit log entry for async batch writing.
 * @param {object} params
 * @param {string} params.eventType - From AUDIT_EVENTS
 * @param {string} params.userId
 * @param {string} params.userRole
 * @param {string} params.ipAddress
 * @param {string} params.requestId
 * @param {object} params.beforeState
 * @param {object} params.afterState
 * @param {object} params.metadata
 */
export function queueAuditLog({
    eventType,
    userId,
    userRole,
    ipAddress,
    requestId,
    beforeState,
    afterState,
    metadata
}) {
    const logEntry = {
        id: generateLogId(),
        event_type: eventType,
        severity: getEventSeverity(eventType),
        user_id: userId || 'system',
        user_role: userRole || 'system',
        ip_address: ipAddress || 'unknown',
        request_id: requestId || '',
        before_state: beforeState || null,
        after_state: afterState || null,
        metadata: metadata || {},
        timestamp: new Date().toISOString()
    };

    logBuffer.push(logEntry);

    if (logBuffer.length >= BATCH_SIZE) {
        flushAuditLogs().catch(err => {
            logger.error({ err }, 'Batch threshold audit flush failed');
        });
    }
}

/**
 * Flushes the current buffer to Supabase.
 */
async function flushAuditLogs() {
    if (logBuffer.length === 0 || !supabaseAdmin) return;

    // Swap buffer to allow new writes during DB insert
    const batchToWrite = logBuffer;
    logBuffer = [];

    try {
        // Sign the batch for tamper detection
        const signature = signLogBatch(batchToWrite, SIGNING_SECRET);

        const { error } = await supabaseAdmin
            .from('audit_logs')
            .insert(batchToWrite.map(log => ({
                ...log,
                batch_signature: signature
            })));

        if (error) {
            logger.error({ err: error, count: batchToWrite.length }, 'Failed to insert audit logs');
            // In production, push to dead-letter queue or file
            // For now, log to console as fallback
            console.error('AUDIT FALLBACK:', JSON.stringify(batchToWrite));
        }
    } catch (err) {
        logger.error({ err }, 'Unexpected error flushing audit logs');
    }
}

/**
 * Queries audit logs with filtering and pagination.
 * @param {object} filters
 * @param {string} filters.userId
 * @param {string} filters.eventType
 * @param {string} filters.severity
 * @param {string} filters.startDate
 * @param {string} filters.endDate
 * @param {number} filters.limit
 * @param {number} filters.offset
 * @returns {Promise<{logs: object[], total: number}>}
 */
export async function queryAuditLogs(filters = {}) {
    if (!supabaseAdmin) throw new Error('Supabase not configured');

    let query = supabaseAdmin
        .from('audit_logs')
        .select('*', { count: 'exact' });

    if (filters.userId) query = query.eq('user_id', filters.userId);
    if (filters.eventType) query = query.eq('event_type', filters.eventType);
    if (filters.severity) query = query.eq('severity', filters.severity);
    if (filters.startDate) query = query.gte('timestamp', filters.startDate);
    if (filters.endDate) query = query.lte('timestamp', filters.endDate);
    if (filters.requestId) query = query.eq('request_id', filters.requestId);

    const limit = Math.min(filters.limit || 100, 1000);
    const offset = filters.offset || 0;

    query = query
        .order('timestamp', { ascending: false })
        .range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
        logger.error({ err: error }, 'Failed to query audit logs');
        throw new Error('Database error querying logs');
    }

    return { logs: data || [], total: count || 0 };
}

/**
 * Exports audit logs to JSON format.
 * @param {object} filters 
 * @returns {Promise<string>} JSON string
 */
export async function exportAuditLogsJSON(filters) {
    const { logs } = await queryAuditLogs({ ...filters, limit: 10000 });
    return JSON.stringify(logs, null, 2);
}
