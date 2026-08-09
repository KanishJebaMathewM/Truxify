import logger from '../../middleware/logger.js';
import * as Sentry from '@sentry/node';
import { measureExecution } from '../../core/performanceMetrics.js';

const ALERT_CHANNELS = {
  SLACK: 'slack',
  EMAIL: 'email',
  SMS: 'sms',
  DASHBOARD: 'dashboard',
};

const SEVERITY_LEVELS = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
};

const SEVERITY_CHANNELS = {
  [SEVERITY_LEVELS.CRITICAL]: [ALERT_CHANNELS.SLACK, ALERT_CHANNELS.SMS, ALERT_CHANNELS.EMAIL],
  [SEVERITY_LEVELS.HIGH]: [ALERT_CHANNELS.SLACK, ALERT_CHANNELS.EMAIL],
  [SEVERITY_LEVELS.MEDIUM]: [ALERT_CHANNELS.SLACK],
  [SEVERITY_LEVELS.LOW]: [ALERT_CHANNELS.DASHBOARD],
};

class AlertRouter {
  constructor(deps = {}) {
    this.notificationService = deps.notificationService;
    this.slackClient = deps.slackClient;
    this.emailService = deps.emailService;
    this.smsService = deps.smsService;
  }

  async route(alert) {
    return measureExecution('AlertRouter.route', async () => {
      const channels = SEVERITY_CHANNELS[alert.severity] || [ALERT_CHANNELS.DASHBOARD];

      logger.info(`[AlertRouter] Routing alert type=${alert.type}, severity=${alert.severity} to ${channels.join(', ')}`);

      const routingPromises = channels.map(channel => this.sendToChannel(channel, alert));
      const results = await Promise.allSettled(routingPromises);

      results.forEach((result, idx) => {
        if (result.status === 'rejected') {
          logger.error(`[AlertRouter] Failed to send to ${channels[idx]}:`, result.reason);
          Sentry.captureException(result.reason);
        }
      });

      return results;
    });
  }

  async sendToChannel(channel, alert) {
    try {
      switch (channel) {
        case ALERT_CHANNELS.SLACK:
          return await this.sendSlackAlert(alert);
        case ALERT_CHANNELS.EMAIL:
          return await this.sendEmailAlert(alert);
        case ALERT_CHANNELS.SMS:
          return await this.sendSMSAlert(alert);
        case ALERT_CHANNELS.DASHBOARD:
          return await this.logToDashboard(alert);
        default:
          logger.warn(`[AlertRouter] Unknown channel: ${channel}`);
      }
    } catch (err) {
      logger.error(`[AlertRouter] Error sending to ${channel}:`, err.message);
      throw err;
    }
  }

  async sendSlackAlert(alert) {
    if (!this.slackClient) {
      logger.warn('[AlertRouter] Slack client not configured');
      return null;
    }

    const message = this.formatSlackMessage(alert);
    await this.slackClient.sendMessage(message);
    logger.info(`[AlertRouter] Slack alert sent for ${alert.type}`);
  }

  formatSlackMessage(alert) {
    const color = this.getSeverityColor(alert.severity);
    const typeEmoji = this.getTypeEmoji(alert.type);

    let text = `${typeEmoji} *${alert.type}* (${alert.severity})`;
    if (alert.reason) text += `\n*Reason:* ${alert.reason}`;
    if (alert.driver) text += `\n*Driver:* ${alert.driver}`;
    if (alert.wallet) text += `\n*Wallet:* ${alert.wallet}`;
    if (alert.txHash) text += `\n*TX:* \`${alert.txHash}\``;

    return {
      attachments: [{
        color,
        text,
        ts: Math.floor(Date.now() / 1000),
      }],
    };
  }

  async sendEmailAlert(alert) {
    if (!this.emailService) {
      logger.warn('[AlertRouter] Email service not configured');
      return null;
    }

    const subject = `[${alert.severity}] ${alert.type}`;
    const body = this.formatEmailBody(alert);

    await this.emailService.send({
      to: process.env.ALERT_EMAIL_RECIPIENTS || 'alerts@truxify.io',
      subject,
      body,
    });

    logger.info(`[AlertRouter] Email alert sent for ${alert.type}`);
  }

  formatEmailBody(alert) {
    const lines = [
      `Alert Type: ${alert.type}`,
      `Severity: ${alert.severity}`,
      `Timestamp: ${new Date().toISOString()}`,
      '',
      `Details:`,
    ];

    if (alert.reason) lines.push(`  Reason: ${alert.reason}`);
    if (alert.driver) lines.push(`  Driver: ${alert.driver}`);
    if (alert.wallet) lines.push(`  Wallet: ${alert.wallet}`);
    if (alert.shipmentId) lines.push(`  Shipment ID: ${alert.shipmentId}`);
    if (alert.claimId) lines.push(`  Claim ID: ${alert.claimId}`);
    if (alert.txHash) lines.push(`  Transaction: ${alert.txHash}`);
    if (alert.blockNumber) lines.push(`  Block: ${alert.blockNumber}`);

    return lines.join('\n');
  }

  async sendSMSAlert(alert) {
    if (!this.smsService) {
      logger.warn('[AlertRouter] SMS service not configured');
      return null;
    }

    const message = `[${alert.severity}] ${alert.type}: ${alert.reason || 'Check dashboard for details'}`;
    const phoneNumbers = (process.env.ALERT_SMS_RECIPIENTS || '').split(',').filter(p => p.trim());

    for (const phone of phoneNumbers) {
      await this.smsService.send({
        to: phone.trim(),
        message,
      });
    }

    logger.info(`[AlertRouter] SMS alert sent for ${alert.type}`);
  }

  async logToDashboard(alert) {
    logger.info(`[AlertRouter] Dashboard event logged: ${alert.type} (${alert.severity})`);
  }

  getSeverityColor(severity) {
    const colors = {
      CRITICAL: 'danger',
      HIGH: 'warning',
      MEDIUM: 'good',
      LOW: '#808080',
    };
    return colors[severity] || '#808080';
  }

  getTypeEmoji(type) {
    const emojis = {
      PAYMENT_RECEIVED: '💰',
      INSURANCE_CLAIM_APPROVED: '✅',
      INSURANCE_CLAIM_REJECTED: '❌',
      GEOFENCE_BREACH: '⚠️',
      BALANCE_UPDATE_FAILED: '🚨',
      SMART_CONTRACT_REVERT: '💥',
    };
    return emojis[type] || '📢';
  }
}

export default AlertRouter;
export { SEVERITY_LEVELS, ALERT_CHANNELS };
