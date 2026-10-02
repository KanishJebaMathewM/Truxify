import logger from '../../middleware/logger.js';
import { supabase } from '../../config/db.js';

/**
 * IncidentAlertService: Handles Cold-Chain Breaches and Telematics Anomaly Escalation
 */
export class IncidentAlertService {
  constructor(options = {}) {
    this.supabase = options.supabase || supabase;
  }

  /**
   * Dispatches incident alerts, writes audit logs, and flags escrow records.
   * 
   * @param {string} tripId
   * @param {object} anomalyResult
   * @param {object} windowSummary
   * @param {object} context
   */
  async handleIncident(tripId, anomalyResult, windowSummary, context = {}) {
    const { severity, violations, cargoProfile } = anomalyResult;

    logger.warn(
      { tripId, severity, violationsCount: violations.length, cargoProfile },
      `[IncidentAlertService] IoT Cold-Chain / Telematics Anomaly Detected (${severity})`
    );

    // 1. Persist to Audit Log
    try {
      if (this.supabase && typeof this.supabase.from === 'function') {
        await this.supabase.from('audit_logs').insert({
          event_type: 'TELEMATICS_ANOMALY_DETECTED',
          entity_type: 'TRIP',
          entity_id: tripId,
          severity,
          metadata: {
            violations,
            windowSummary,
            cargoProfile,
            context,
            detectedAt: new Date().toISOString(),
          },
        });
      }
    } catch (err) {
      logger.error({ err, tripId }, '[IncidentAlertService] Failed to record audit log');
    }

    // 2. If CRITICAL / HIGH: Flag Booking Dispute / SLA Warning
    if (severity === 'CRITICAL' || severity === 'HIGH') {
      try {
        if (this.supabase && typeof this.supabase.from === 'function') {
          await this.supabase
            .from('bookings')
            .update({
              sla_breached: true,
              sla_breach_reason: violations.map((v) => v.message).join(' | '),
              escrow_dispute_flag: severity === 'CRITICAL',
              updated_at: new Date().toISOString(),
            })
            .eq('id', tripId);
        }
      } catch (err) {
        logger.error({ err, tripId }, '[IncidentAlertService] Failed updating booking SLA flags');
      }
    }

    // 3. Dispatch Notification / Alert Payload
    const notificationPayload = {
      title: `🚨 Cold-Chain Alert: ${severity} Breach on Trip #${tripId.slice(0, 8)}`,
      body: violations[0]?.message || 'Telematics anomaly detected on active freight shipment',
      data: {
        tripId,
        severity,
        violations: JSON.stringify(violations),
        timestamp: new Date().toISOString(),
      },
    };

    logger.info({ tripId, notification: notificationPayload }, '[IncidentAlertService] Emergency alert dispatched');
    return notificationPayload;
  }
}

export default IncidentAlertService;
