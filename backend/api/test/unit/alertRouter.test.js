import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/core/performanceMetrics.js', () => ({
  measureExecution: vi.fn(async (name, fn) => fn()),
}));

vi.mock('@sentry/node', () => ({
  captureException: vi.fn(),
}));

import AlertRouter, {
  ALERT_CHANNELS,
  SEVERITY_LEVELS,
} from '../../src/services/blockchain/alertRouter.js';

describe('AlertRouter', () => {
  let router;
  let mockSlack;
  let mockEmail;
  let mockSms;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ALERT_SMS_RECIPIENTS = '+1234567890';
    mockSlack = { sendMessage: vi.fn().mockResolvedValue(true) };
    mockEmail = { send: vi.fn().mockResolvedValue(true) };
    mockSms = { send: vi.fn().mockResolvedValue(true) };

    router = new AlertRouter({
      slackClient: mockSlack,
      emailService: mockEmail,
      smsService: mockSms,
    });
  });

  describe('route', () => {
    it('routes CRITICAL alerts to Slack, SMS, and Email', async () => {
      const alert = {
        type: 'CIRCUIT_BREAKER_TRIGGERED',
        severity: 'CRITICAL',
        bookingId: 'bk-999',
        reason: 'Oracle divergence detected',
      };

      const results = await router.route(alert);
      expect(results).toHaveLength(3);
      expect(mockSlack.sendMessage).toHaveBeenCalledTimes(1);
      expect(mockSms.send).toHaveBeenCalledTimes(1);
      expect(mockEmail.send).toHaveBeenCalledTimes(1);
    });

    it('routes HIGH alerts to Slack and Email', async () => {
      const alert = {
        type: 'ESCROW_DISPUTE_RAISED',
        severity: 'HIGH',
        bookingId: 'bk-555',
      };

      const results = await router.route(alert);
      expect(results).toHaveLength(2);
      expect(mockSlack.sendMessage).toHaveBeenCalledTimes(1);
      expect(mockEmail.send).toHaveBeenCalledTimes(1);
      expect(mockSms.send).not.toHaveBeenCalled();
    });

    it('routes MEDIUM alerts to Slack only', async () => {
      const alert = {
        type: 'GAS_PRICE_SURGE',
        severity: 'MEDIUM',
      };

      const results = await router.route(alert);
      expect(results).toHaveLength(1);
      expect(mockSlack.sendMessage).toHaveBeenCalledTimes(1);
      expect(mockEmail.send).not.toHaveBeenCalled();
      expect(mockSms.send).not.toHaveBeenCalled();
    });

    it('routes LOW alerts to Dashboard', async () => {
      const alert = {
        type: 'HEARTBEAT_OK',
        severity: 'LOW',
      };

      const results = await router.route(alert);
      expect(results).toHaveLength(1);
      expect(mockSlack.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('sendToChannel error handling', () => {
    it('rejects when a requested channel is not configured on the router', async () => {
      const unconfiguredRouter = new AlertRouter();

      await expect(
        unconfiguredRouter.sendToChannel('slack', { type: 'TEST', severity: 'HIGH' })
      ).rejects.toThrow('Slack client not configured');

      await expect(
        unconfiguredRouter.sendToChannel('email', { type: 'TEST', severity: 'HIGH' })
      ).rejects.toThrow('Email service not configured');

      await expect(
        unconfiguredRouter.sendToChannel('sms', { type: 'TEST', severity: 'CRITICAL' })
      ).rejects.toThrow('SMS service not configured');
    });
  });

  describe('message formatting helpers', () => {
    it('formats Slack message attachment with severity color and emoji', () => {
      const alert = {
        type: 'PAYMENT_RECEIVED',
        severity: 'HIGH',
        bookingId: 'bk-12',
        driver: 'driver-9',
        amount: '1500',
      };

      const slackMsg = router.formatSlackMessage(alert);
      expect(slackMsg.attachments).toBeDefined();
      expect(slackMsg.attachments[0].color).toBe('warning');
      expect(slackMsg.attachments[0].text).toContain('💰 *PAYMENT_RECEIVED* (HIGH)');
      expect(slackMsg.attachments[0].text).toContain('*Booking ID:* bk-12');
      expect(slackMsg.attachments[0].text).toContain('*Amount:* 1500');
    });

    it('formats Email body with alert type, timestamp, and details', () => {
      const alert = {
        type: 'RECONCILIATION_ERROR',
        severity: 'CRITICAL',
        bookingId: 'bk-100',
        reason: 'Mismatch in escrow balance',
      };

      const body = router.formatEmailBody(alert);
      expect(body).toContain('Alert Type: RECONCILIATION_ERROR');
      expect(body).toContain('Severity: CRITICAL');
      expect(body).toContain('Booking ID: bk-100');
      expect(body).toContain('Reason: Mismatch in escrow balance');
    });

    it('returns appropriate emojis and color indicators for event types and severities', () => {
      expect(router.getSeverityColor('CRITICAL')).toBe('danger');
      expect(router.getSeverityColor('HIGH')).toBe('warning');
      expect(router.getSeverityColor('MEDIUM')).toBe('good');
      expect(router.getSeverityColor('LOW')).toBe('#808080');

      expect(router.getTypeEmoji('PAYMENT_RECEIVED')).toBe('💰');
      expect(router.getTypeEmoji('BOOKING_CANCELLED')).toBe('🚫');
      expect(router.getTypeEmoji('SMART_CONTRACT_REVERT')).toBe('💥');
      expect(router.getTypeEmoji('UNKNOWN_EVENT')).toBe('📢');
    });
  });

  describe('constants export', () => {
    it('exports ALERT_CHANNELS and SEVERITY_LEVELS', () => {
      expect(ALERT_CHANNELS.SLACK).toBe('slack');
      expect(SEVERITY_LEVELS.CRITICAL).toBe('CRITICAL');
    });
  });
});
