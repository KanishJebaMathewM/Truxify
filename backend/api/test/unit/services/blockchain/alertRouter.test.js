import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

const mockSentry = vi.hoisted(() => ({
  captureException: vi.fn(),
}));

vi.mock('../../../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

vi.mock('@sentry/node', () => ({
  captureException: mockSentry.captureException,
}));

vi.mock('../../../../src/core/performanceMetrics.js', () => ({
  measureExecution: (name, fn) => fn(),
}));

import AlertRouter, {
  ALERT_CHANNELS,
  SEVERITY_LEVELS,
} from '../../../../src/services/blockchain/alertRouter.js';

function buildRouter(overrides = {}) {
  const notificationService = overrides.notificationService || {};
  const slackClient = overrides.slackClient || {
    sendMessage: vi.fn().mockResolvedValue({ ok: true }),
  };
  const emailService = overrides.emailService || {
    send: vi.fn().mockResolvedValue({ id: 'email-1' }),
  };
  const smsService = overrides.smsService || {
    send: vi.fn().mockResolvedValue({ id: 'sms-1' }),
  };
  const router = new AlertRouter({
    notificationService,
    slackClient,
    emailService,
    smsService,
    ...overrides,
  });
  return { router, notificationService, slackClient, emailService, smsService };
}

const SAMPLE_CRITICAL_ALERT = {
  type: 'BALANCE_UPDATE_FAILED',
  severity: 'CRITICAL',
  reason: 'Insufficient wallet balance for gas fees',
  driver: 'driver-101',
  wallet: '0x71C...49A',
  shipmentId: 'shp-550',
  claimId: 'clm-880',
  txHash: '0x9abc...def',
  blockNumber: 19827364,
};

describe('AlertRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Exports and Constants', () => {
    it('exports ALERT_CHANNELS and SEVERITY_LEVELS', () => {
      expect(ALERT_CHANNELS).toEqual({
        SLACK: 'slack',
        EMAIL: 'email',
        SMS: 'sms',
        DASHBOARD: 'dashboard',
      });
      expect(SEVERITY_LEVELS).toEqual({
        LOW: 'LOW',
        MEDIUM: 'MEDIUM',
        HIGH: 'HIGH',
        CRITICAL: 'CRITICAL',
      });
    });
  });

  describe('route() dispatching per severity', () => {
    it('dispatches CRITICAL alerts to SLACK, SMS, and EMAIL', async () => {
      process.env.ALERT_SMS_RECIPIENTS = '+919876543210';
      const { router, slackClient, emailService, smsService } = buildRouter();

      const results = await router.route(SAMPLE_CRITICAL_ALERT);

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
      expect(slackClient.sendMessage).toHaveBeenCalledTimes(1);
      expect(smsService.send).toHaveBeenCalledTimes(1);
      expect(emailService.send).toHaveBeenCalledTimes(1);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Routing alert type=BALANCE_UPDATE_FAILED, severity=CRITICAL to slack, sms, email')
      );
      delete process.env.ALERT_SMS_RECIPIENTS;
    });

    it('dispatches HIGH alerts to SLACK and EMAIL', async () => {
      const { router, slackClient, emailService, smsService } = buildRouter();
      const highAlert = { type: 'SMART_CONTRACT_REVERT', severity: 'HIGH', reason: 'Revert in escrow release' };

      const results = await router.route(highAlert);

      expect(results).toHaveLength(2);
      expect(slackClient.sendMessage).toHaveBeenCalledTimes(1);
      expect(emailService.send).toHaveBeenCalledTimes(1);
      expect(smsService.send).not.toHaveBeenCalled();
    });

    it('dispatches MEDIUM alerts to SLACK only', async () => {
      const { router, slackClient, emailService, smsService } = buildRouter();
      const mediumAlert = { type: 'GEOFENCE_BREACH', severity: 'MEDIUM', reason: 'Driver deviated from route' };

      const results = await router.route(mediumAlert);

      expect(results).toHaveLength(1);
      expect(slackClient.sendMessage).toHaveBeenCalledTimes(1);
      expect(emailService.send).not.toHaveBeenCalled();
      expect(smsService.send).not.toHaveBeenCalled();
    });

    it('dispatches LOW alerts to DASHBOARD only', async () => {
      const { router, slackClient, emailService, smsService } = buildRouter();
      const lowAlert = { type: 'PAYMENT_RECEIVED', severity: 'LOW' };

      const results = await router.route(lowAlert);

      expect(results).toHaveLength(1);
      expect(slackClient.sendMessage).not.toHaveBeenCalled();
      expect(emailService.send).not.toHaveBeenCalled();
      expect(smsService.send).not.toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Dashboard event logged: PAYMENT_RECEIVED (LOW)')
      );
    });

    it('falls back to DASHBOARD channel when severity is unknown or missing', async () => {
      const { router, slackClient, emailService, smsService } = buildRouter();
      const unknownAlert = { type: 'CUSTOM_EVENT', severity: 'INFORMATIONAL' };

      const results = await router.route(unknownAlert);

      expect(results).toHaveLength(1);
      expect(slackClient.sendMessage).not.toHaveBeenCalled();
      expect(emailService.send).not.toHaveBeenCalled();
      expect(smsService.send).not.toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Dashboard event logged: CUSTOM_EVENT (INFORMATIONAL)')
      );
    });
  });

  describe('route() error handling with Promise.allSettled', () => {
    it('handles rejected channel promises, logs error, and captures with Sentry', async () => {
      const slackError = new Error('Slack API rate limit exceeded');
      const slackClient = {
        sendMessage: vi.fn().mockRejectedValue(slackError),
      };
      const { router, emailService } = buildRouter({ slackClient });

      const highAlert = { type: 'SMART_CONTRACT_REVERT', severity: 'HIGH' };
      const results = await router.route(highAlert);

      expect(results).toHaveLength(2);
      expect(results[0].status).toBe('rejected');
      expect(results[0].reason).toBe(slackError);
      expect(results[1].status).toBe('fulfilled');
      expect(emailService.send).toHaveBeenCalled();

      expect(mockLogger.error).toHaveBeenCalledWith(
        { channel: 'slack', reason: slackError },
        '[AlertRouter] Failed to send alert'
      );
      expect(mockSentry.captureException).toHaveBeenCalledWith(slackError);
    });
  });

  describe('sendToChannel() delegation', () => {
    it('delegates to sendSlackAlert for SLACK channel', async () => {
      const { router, slackClient } = buildRouter();
      await router.sendToChannel(ALERT_CHANNELS.SLACK, SAMPLE_CRITICAL_ALERT);
      expect(slackClient.sendMessage).toHaveBeenCalledTimes(1);
    });

    it('delegates to sendEmailAlert for EMAIL channel', async () => {
      const { router, emailService } = buildRouter();
      await router.sendToChannel(ALERT_CHANNELS.EMAIL, SAMPLE_CRITICAL_ALERT);
      expect(emailService.send).toHaveBeenCalledTimes(1);
    });

    it('delegates to sendSMSAlert for SMS channel', async () => {
      process.env.ALERT_SMS_RECIPIENTS = '+919999999999';
      const { router, smsService } = buildRouter();
      await router.sendToChannel(ALERT_CHANNELS.SMS, SAMPLE_CRITICAL_ALERT);
      expect(smsService.send).toHaveBeenCalledTimes(1);
      delete process.env.ALERT_SMS_RECIPIENTS;
    });

    it('delegates to logToDashboard for DASHBOARD channel', async () => {
      const { router } = buildRouter();
      await router.sendToChannel(ALERT_CHANNELS.DASHBOARD, SAMPLE_CRITICAL_ALERT);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Dashboard event logged: BALANCE_UPDATE_FAILED (CRITICAL)')
      );
    });

    it('warns on unknown alert channel and returns undefined', async () => {
      const { router } = buildRouter();
      const result = await router.sendToChannel('webhook', SAMPLE_CRITICAL_ALERT);
      expect(result).toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        { channel: 'webhook' },
        '[AlertRouter] Unknown alert channel'
      );
    });

    it('catches, logs, and re-throws when channel sending throws', async () => {
      const error = new Error('Network failure');
      const slackClient = {
        sendMessage: vi.fn().mockRejectedValue(error),
      };
      const { router } = buildRouter({ slackClient });

      await expect(router.sendToChannel(ALERT_CHANNELS.SLACK, SAMPLE_CRITICAL_ALERT)).rejects.toThrow(
        'Network failure'
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        { err: error, channel: 'slack', alertType: 'BALANCE_UPDATE_FAILED' },
        '[AlertRouter] Error sending alert to channel'
      );
    });

    it('rejects with an error and logs warning when slackClient is null in sendToChannel', async () => {
      const router = new AlertRouter({ slackClient: null });
      await expect(router.sendToChannel(ALERT_CHANNELS.SLACK, SAMPLE_CRITICAL_ALERT)).rejects.toThrow(
        'Slack client not configured'
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        { channel: 'slack' },
        '[AlertRouter] Slack client not configured'
      );
    });

    it('rejects with an error and logs warning when emailService is null in sendToChannel', async () => {
      const router = new AlertRouter({ emailService: null });
      await expect(router.sendToChannel(ALERT_CHANNELS.EMAIL, SAMPLE_CRITICAL_ALERT)).rejects.toThrow(
        'Email service not configured'
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        { channel: 'email' },
        '[AlertRouter] Email service not configured'
      );
    });

    it('rejects with an error and logs warning when smsService is null in sendToChannel', async () => {
      const router = new AlertRouter({ smsService: null });
      await expect(router.sendToChannel(ALERT_CHANNELS.SMS, SAMPLE_CRITICAL_ALERT)).rejects.toThrow(
        'SMS service not configured'
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        { channel: 'sms' },
        '[AlertRouter] SMS service not configured'
      );
    });
  });

  describe('Individual send*Alert methods and unconfigured clients', () => {
    it('sendSlackAlert logs warning and returns null when slackClient is not configured', async () => {
      const router = new AlertRouter({});
      const result = await router.sendSlackAlert(SAMPLE_CRITICAL_ALERT);
      expect(result).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith('[AlertRouter] Slack client not configured');
    });

    it('sendEmailAlert logs warning and returns null when emailService is not configured', async () => {
      const router = new AlertRouter({});
      const result = await router.sendEmailAlert(SAMPLE_CRITICAL_ALERT);
      expect(result).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith('[AlertRouter] Email service not configured');
    });

    it('sendEmailAlert uses default recipient if ALERT_EMAIL_RECIPIENTS is unset', async () => {
      delete process.env.ALERT_EMAIL_RECIPIENTS;
      const { router, emailService } = buildRouter();
      await router.sendEmailAlert(SAMPLE_CRITICAL_ALERT);

      expect(emailService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'alerts@truxify.io',
          subject: '[CRITICAL] BALANCE_UPDATE_FAILED',
        })
      );
    });

    it('sendEmailAlert uses custom recipient from process.env.ALERT_EMAIL_RECIPIENTS', async () => {
      process.env.ALERT_EMAIL_RECIPIENTS = 'ops@truxify.io,devs@truxify.io';
      const { router, emailService } = buildRouter();
      await router.sendEmailAlert(SAMPLE_CRITICAL_ALERT);

      expect(emailService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'ops@truxify.io,devs@truxify.io',
        })
      );
      delete process.env.ALERT_EMAIL_RECIPIENTS;
    });

    it('sendSMSAlert logs warning and returns null when smsService is not configured', async () => {
      const router = new AlertRouter({});
      const result = await router.sendSMSAlert(SAMPLE_CRITICAL_ALERT);
      expect(result).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith('[AlertRouter] SMS service not configured');
    });

    it('sendSMSAlert sends to multiple configured recipients', async () => {
      process.env.ALERT_SMS_RECIPIENTS = '+919876543210, +919876543211, ';
      const { router, smsService } = buildRouter();
      await router.sendSMSAlert(SAMPLE_CRITICAL_ALERT);

      expect(smsService.send).toHaveBeenCalledTimes(2);
      expect(smsService.send).toHaveBeenNthCalledWith(1, {
        to: '+919876543210',
        message: expect.stringContaining('[CRITICAL] BALANCE_UPDATE_FAILED'),
      });
      expect(smsService.send).toHaveBeenNthCalledWith(2, {
        to: '+919876543211',
        message: expect.stringContaining('[CRITICAL] BALANCE_UPDATE_FAILED'),
      });
      delete process.env.ALERT_SMS_RECIPIENTS;
    });
  });

  describe('Formatting helpers', () => {
    it('formatSlackMessage formats fields with attachment color and emoji', () => {
      const { router } = buildRouter();
      const formatted = router.formatSlackMessage(SAMPLE_CRITICAL_ALERT);

      expect(formatted.attachments).toHaveLength(1);
      const attachment = formatted.attachments[0];
      expect(attachment.color).toBe('danger');
      expect(attachment.text).toContain('🚨 *BALANCE_UPDATE_FAILED* (CRITICAL)');
      expect(attachment.text).toContain('*Reason:* Insufficient wallet balance for gas fees');
      expect(attachment.text).toContain('*Driver:* driver-101');
      expect(attachment.text).toContain('*Wallet:* 0x71C...49A');
      expect(attachment.text).toContain('*TX:* `0x9abc...def`');
      expect(attachment.ts).toBeTypeOf('number');
    });

    it('formatEmailBody formats all metadata fields when present', () => {
      const { router } = buildRouter();
      const body = router.formatEmailBody(SAMPLE_CRITICAL_ALERT);

      expect(body).toContain('Alert Type: BALANCE_UPDATE_FAILED');
      expect(body).toContain('Severity: CRITICAL');
      expect(body).toContain('Reason: Insufficient wallet balance for gas fees');
      expect(body).toContain('Driver: driver-101');
      expect(body).toContain('Wallet: 0x71C...49A');
      expect(body).toContain('Shipment ID: shp-550');
      expect(body).toContain('Claim ID: clm-880');
      expect(body).toContain('Transaction: 0x9abc...def');
      expect(body).toContain('Block: 19827364');
    });

    it('getSeverityColor returns corresponding colors', () => {
      const { router } = buildRouter();
      expect(router.getSeverityColor(SEVERITY_LEVELS.CRITICAL)).toBe('danger');
      expect(router.getSeverityColor(SEVERITY_LEVELS.HIGH)).toBe('warning');
      expect(router.getSeverityColor(SEVERITY_LEVELS.MEDIUM)).toBe('good');
      expect(router.getSeverityColor(SEVERITY_LEVELS.LOW)).toBe('#808080');
      expect(router.getSeverityColor('NON_EXISTENT')).toBe('#808080');
    });

    it('getTypeEmoji maps recognized alert types to emojis and defaults', () => {
      const { router } = buildRouter();
      expect(router.getTypeEmoji('PAYMENT_RECEIVED')).toBe('💰');
      expect(router.getTypeEmoji('INSURANCE_CLAIM_APPROVED')).toBe('✅');
      expect(router.getTypeEmoji('INSURANCE_CLAIM_REJECTED')).toBe('❌');
      expect(router.getTypeEmoji('GEOFENCE_BREACH')).toBe('[WARNING]');
      expect(router.getTypeEmoji('BALANCE_UPDATE_FAILED')).toBe('🚨');
      expect(router.getTypeEmoji('SMART_CONTRACT_REVERT')).toBe('💥');
      expect(router.getTypeEmoji('OTHER_UNRECOGNIZED_TYPE')).toBe('📢');
    });
  });
});
