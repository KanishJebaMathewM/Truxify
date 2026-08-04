import logger from '../../middleware/logger.js';
import * as Sentry from '@sentry/node';
import { supabase } from '../../config/db.js';
import { measureExecution } from '../../core/performanceMetrics.js';

const ESCALATION_THRESHOLDS = {
  FIRST_ESCALATION: 5 * 60 * 1000, // 5 minutes
  SECOND_ESCALATION: 15 * 60 * 1000, // 15 minutes
  FINAL_ESCALATION: 60 * 60 * 1000, // 1 hour
};

const ESCALATION_LEVELS = {
  ALERT: 0,
  ON_CALL: 1,
  SENIOR_ENGINEER: 2,
  OPERATIONS: 3,
};

class EscalationHandler {
  constructor(deps = {}) {
    this.notificationService = deps.notificationService;
    this.alertRouter = deps.alertRouter;
    this.activeAlerts = new Map();
    this.escalationTimers = new Map();
  }

  async escalate(alert) {
    return measureExecution('EscalationHandler.escalate', async () => {
      const alertId = this.generateAlertId(alert);

      if (this.activeAlerts.has(alertId)) {
        logger.warn(`[EscalationHandler] Alert ${alertId} already being tracked`);
        return;
      }

      const escalationRecord = {
        alertId,
        alert,
        level: ESCALATION_LEVELS.ALERT,
        createdAt: Date.now(),
        escalatedAt: [],
        resolved: false,
      };

      this.activeAlerts.set(alertId, escalationRecord);
      await this.storeEscalation(escalationRecord);

      logger.info(`[EscalationHandler] Started tracking alert: ${alertId}`);

      this.setupEscalationTimers(alertId, escalationRecord);
    });
  }

  setupEscalationTimers(alertId, record) {
    const firstTimer = setTimeout(() => {
      this.performEscalation(alertId, ESCALATION_LEVELS.ON_CALL);
    }, ESCALATION_THRESHOLDS.FIRST_ESCALATION);

    const secondTimer = setTimeout(() => {
      this.performEscalation(alertId, ESCALATION_LEVELS.SENIOR_ENGINEER);
    }, ESCALATION_THRESHOLDS.SECOND_ESCALATION);

    const finalTimer = setTimeout(() => {
      this.performEscalation(alertId, ESCALATION_LEVELS.OPERATIONS);
    }, ESCALATION_THRESHOLDS.FINAL_ESCALATION);

    this.escalationTimers.set(alertId, [firstTimer, secondTimer, finalTimer]);
  }

  async performEscalation(alertId, level) {
    const record = this.activeAlerts.get(alertId);
    if (!record || record.resolved) {
      return;
    }

    record.level = level;
    record.escalatedAt.push({ level, timestamp: Date.now() });

    logger.warn(`[EscalationHandler] Escalating alert ${alertId} to level ${level}`);

    const escalationAlert = {
      ...record.alert,
      type: `${record.alert.type}_ESCALATED`,
      severity: 'CRITICAL',
      escalationLevel: this.getLevelName(level),
      previousLevel: this.getLevelName(level - 1),
      escalationMessage: this.getEscalationMessage(level),
    };

    await this.alertRouter?.route(escalationAlert);
    await this.notifyEscalation(level, record);
    await this.storeEscalation(record);
  }

  async notifyEscalation(level, record) {
    try {
      const recipients = await this.getEscalationRecipients(level);

      for (const recipient of recipients) {
        await this.notificationService?.sendAlert({
          recipient,
          alert: record.alert,
          escalationLevel: level,
          message: this.getEscalationMessage(level),
        });
      }

      logger.info(`[EscalationHandler] Escalation notification sent to ${recipients.length} recipients`);
    } catch (err) {
      logger.error('[EscalationHandler] Failed to notify escalation:', err.message);
      Sentry.captureException(err);
    }
  }

  async getEscalationRecipients(level) {
    const recipients = [];

    switch (level) {
      case ESCALATION_LEVELS.ON_CALL:
        recipients.push(...(process.env.ON_CALL_ENGINEER || '').split(',').filter(e => e.trim()));
        break;
      case ESCALATION_LEVELS.SENIOR_ENGINEER:
        recipients.push(...(process.env.SENIOR_ENGINEER_CONTACTS || '').split(',').filter(e => e.trim()));
        break;
      case ESCALATION_LEVELS.OPERATIONS:
        recipients.push(...(process.env.OPERATIONS_TEAM_CONTACTS || '').split(',').filter(e => e.trim()));
        break;
    }

    return recipients;
  }

  getLevelName(level) {
    const names = {
      [ESCALATION_LEVELS.ALERT]: 'ALERT',
      [ESCALATION_LEVELS.ON_CALL]: 'ON_CALL',
      [ESCALATION_LEVELS.SENIOR_ENGINEER]: 'SENIOR_ENGINEER',
      [ESCALATION_LEVELS.OPERATIONS]: 'OPERATIONS',
    };
    return names[level] || 'UNKNOWN';
  }

  getEscalationMessage(level) {
    const messages = {
      [ESCALATION_LEVELS.ON_CALL]: 'Alert not acknowledged. Paging on-call engineer.',
      [ESCALATION_LEVELS.SENIOR_ENGINEER]: 'Alert not resolved. Escalating to senior engineer.',
      [ESCALATION_LEVELS.OPERATIONS]: 'Alert critical. Notifying operations team.',
    };
    return messages[level] || 'Escalation in progress';
  }

  async resolveAlert(alertId) {
    return measureExecution('EscalationHandler.resolveAlert', async () => {
      const record = this.activeAlerts.get(alertId);
      if (!record) {
        logger.warn(`[EscalationHandler] Alert ${alertId} not found`);
        return false;
      }

      record.resolved = true;
      record.resolvedAt = Date.now();

      this.clearEscalationTimers(alertId);
      await this.storeEscalation(record);

      logger.info(`[EscalationHandler] Alert ${alertId} resolved after ${record.resolvedAt - record.createdAt}ms`);

      this.activeAlerts.delete(alertId);
      return true;
    });
  }

  clearEscalationTimers(alertId) {
    const timers = this.escalationTimers.get(alertId);
    if (timers) {
      timers.forEach(timer => clearTimeout(timer));
      this.escalationTimers.delete(alertId);
    }
  }

  generateAlertId(alert) {
    const key = [alert.type, alert.driver || alert.wallet || alert.shipmentId || 'unknown'].join('_');
    return Buffer.from(key).toString('hex').slice(0, 16);
  }

  async storeEscalation(record) {
    try {
      await supabase
        .from('blockchain_escalations')
        .upsert([{
          alert_id: record.alertId,
          alert_type: record.alert.type,
          severity: record.alert.severity,
          escalation_level: record.level,
          created_at: new Date(record.createdAt).toISOString(),
          resolved: record.resolved,
          resolved_at: record.resolvedAt ? new Date(record.resolvedAt).toISOString() : null,
          escalation_history: record.escalatedAt,
          data: record.alert,
        }], { onConflict: 'alert_id' });
    } catch (err) {
      logger.error('[EscalationHandler] Failed to store escalation:', err.message);
    }
  }

  async getActiveAlerts() {
    const alerts = [];
    for (const [alertId, record] of this.activeAlerts.entries()) {
      if (!record.resolved) {
        alerts.push({
          alertId,
          ...record,
          elapsedTime: Date.now() - record.createdAt,
        });
      }
    }
    return alerts;
  }
}

export default EscalationHandler;
export { ESCALATION_LEVELS, ESCALATION_THRESHOLDS };
