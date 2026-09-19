/**
 * @fileoverview Scheduled job for tracking document expiry and sending alerts.
 */

import { supabaseAdmin } from '../config/db.js';
import logger from '../middleware/logger.js';

const ALERT_THRESHOLDS = [30, 7, 1]; // Days before expiry

/**
 * Finds documents expiring within the specified thresholds.
 * @returns {Promise<object[]>} Documents needing alerts
 */
export async function findExpiringDocuments() {
    if (!supabaseAdmin) return [];

    const now = new Date();
    const alerts = [];

    for (const days of ALERT_THRESHOLDS) {
        const targetDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
        const targetDateStr = targetDate.toISOString().split('T')[0];

        try {
            const { data, error } = await supabaseAdmin
                .from('driver_documents')
                .select(`
          id,
          driver_id,
          document_type,
          document_number,
          expiry_date,
          driver:profiles(full_name, phone)
        `)
                .eq('status', 'verified')
                .eq('expiry_date', targetDateStr)
                .eq('alert_sent_' + days + '_days', false);

            if (error) {
                logger.error({ err: error, days }, 'Failed to query expiring documents');
                continue;
            }

            for (const doc of (data || [])) {
                alerts.push({
                    ...doc,
                    alertThreshold: days,
                    daysUntilExpiry: days
                });
            }
        } catch (err) {
            logger.error({ err, days }, 'Error finding expiring documents');
        }
    }

    return alerts;
}

/**
 * Marks an alert as sent for a document.
 * @param {string} documentId 
 * @param {number} thresholdDays 
 */
export async function markAlertSent(documentId, thresholdDays) {
    if (!supabaseAdmin) return;

    const column = `alert_sent_${thresholdDays}_days`;

    try {
        await supabaseAdmin
            .from('driver_documents')
            .update({ [column]: true, last_alert_sent_at: new Date().toISOString() })
            .eq('id', documentId);
    } catch (err) {
        logger.error({ err, documentId }, 'Failed to mark alert as sent');
    }
}

/**
 * Finds drivers with ANY expired documents (for blocking logic).
 * @param {string} driverId 
 * @returns {Promise<object[]>} Expired documents
 */
export async function getExpiredDocuments(driverId) {
    if (!supabaseAdmin) return [];

    const now = new Date().toISOString().split('T')[0];

    try {
        const { data, error } = await supabaseAdmin
            .from('driver_documents')
            .select('id, document_type, document_number, expiry_date')
            .eq('driver_id', driverId)
            .eq('status', 'verified')
            .lt('expiry_date', now);

        if (error) throw error;

        return data || [];
    } catch (err) {
        logger.error({ err, driverId }, 'Failed to check expired documents');
        return [];
    }
}

/**
 * Checks if a driver is compliant (no expired documents).
 * @param {string} driverId 
 * @returns {Promise<{compliant: boolean, expiredDocs: object[]}>}
 */
export async function checkDriverCompliance(driverId) {
    const expiredDocs = await getExpiredDocuments(driverId);

    return {
        compliant: expiredDocs.length === 0,
        expiredDocs,
        checkedAt: new Date().toISOString()
    };
}

/**
 * Runs the full expiry check job (called by scheduler).
 * @param {Function} sendAlertFn - Function to send notifications
 */
export async function runExpiryCheckJob(sendAlertFn) {
    logger.info('Starting document expiry check job');

    const expiringDocs = await findExpiringDocuments();

    logger.info({ count: expiringDocs.length }, 'Found expiring documents');

    for (const doc of expiringDocs) {
        try {
            if (sendAlertFn && typeof sendAlertFn === 'function') {
                await sendAlertFn({
                    driverId: doc.driver_id,
                    driverName: doc.driver?.full_name || 'Driver',
                    driverPhone: doc.driver?.phone,
                    documentType: doc.document_type,
                    documentNumber: doc.document_number,
                    expiryDate: doc.expiry_date,
                    daysUntilExpiry: doc.alertThreshold
                });
            }

            await markAlertSent(doc.id, doc.alertThreshold);

            logger.info({
                documentId: doc.id,
                driverId: doc.driver_id,
                threshold: doc.alertThreshold
            }, 'Expiry alert sent');
        } catch (err) {
            logger.error({ err, documentId: doc.id }, 'Failed to send expiry alert');
        }
    }

    logger.info('Document expiry check job completed');
}
