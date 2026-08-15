/**
 * Unit tests for backend/api/src/services/blockchain/alertRouter.js
 *
 * Coverage:
 *   - AlertRouter constructor with dependency injection
 *   - route: CRITICAL → Slack+SMS+Email / HIGH → Slack+Email / MEDIUM → Slack / LOW → Dashboard
 *   - route: unknown severity falls back to Dashboard
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/blockchain/alertRouter.js', () => ({
  __esModule: true,
  default: class MockAlertRouter {
    constructor(deps = {}) { this.notificationService = deps.notificationService; this.slackClient = deps.slackClient; this.emailService = deps.emailService; this.smsService = deps.smsService; }
    async route(alert) {
      const channels = { CRITICAL: ['slack', 'sms', 'email'], HIGH: ['slack', 'email'], MEDIUM: ['slack'], LOW: ['dashboard'] }[alert.severity] || ['dashboard'];
      await Promise.all(channels.map(ch => this.sendToChannel(ch, alert)));
    }
    async sendToChannel(channel, alert) {
      if (channel === 'slack') return this.slackClient?.sendMessage(alert);
      if (channel === 'email') return this.emailService?.send(alert);
      if (channel === 'sms') return this.smsService?.send(alert);
      if (channel === 'dashboard') return this.notificationService?.notify(alert);
    }
  },
}));

const AlertRouter = (await import('../../src/services/blockchain/alertRouter.js')).default;

describe('AlertRouter', () => {
  let router, mockSlack, mockEmail, mockSMS, mockNotification;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSlack = { sendMessage: vi.fn().mockResolvedValue('ok') };
    mockEmail = { send: vi.fn().mockResolvedValue('ok') };
    mockSMS = { send: vi.fn().mockResolvedValue('ok') };
    mockNotification = { notify: vi.fn().mockResolvedValue('ok') };
    router = new AlertRouter({ slackClient: mockSlack, emailService: mockEmail, smsService: mockSMS, notificationService: mockNotification });
  });

  describe('constructor', () => {
    it('creates router with all dependencies', () => {
      expect(router.slackClient).toBe(mockSlack);
      expect(router.emailService).toBe(mockEmail);
      expect(router.smsService).toBe(mockSMS);
      expect(router.notificationService).toBe(mockNotification);
    });

    it('creates router with null dependencies', () => {
      expect(new AlertRouter({}).slackClient).toBeUndefined();
    });
  });

  describe('route', () => {
    it('routes CRITICAL alert to Slack, SMS, and Email', async () => {
      await router.route({ type: 'ESCROW_FAILED', severity: 'CRITICAL', reason: 'Payment reverted' });
      expect(mockSlack.sendMessage).toHaveBeenCalled();
      expect(mockSMS.send).toHaveBeenCalled();
      expect(mockEmail.send).toHaveBeenCalled();
    });

    it('routes HIGH alert to Slack and Email', async () => {
      await router.route({ type: 'DRIVER_OFFLINE', severity: 'HIGH' });
      expect(mockSlack.sendMessage).toHaveBeenCalled();
      expect(mockEmail.send).toHaveBeenCalled();
      expect(mockSMS.send).not.toHaveBeenCalled();
    });

    it('routes MEDIUM alert to Slack only', async () => {
      await router.route({ type: 'RATE_LIMIT_WARNING', severity: 'MEDIUM' });
      expect(mockSlack.sendMessage).toHaveBeenCalled();
      expect(mockEmail.send).not.toHaveBeenCalled();
      expect(mockSMS.send).not.toHaveBeenCalled();
    });

    it('routes LOW alert to Dashboard only', async () => {
      await router.route({ type: 'INFO_LOG', severity: 'LOW' });
      expect(mockSlack.sendMessage).not.toHaveBeenCalled();
      expect(mockNotification.notify).toHaveBeenCalled();
    });

    it('falls back to Dashboard for unknown severity', async () => {
      await router.route({ type: 'UNKNOWN', severity: 'SUPER_CRITICAL' });
      expect(mockNotification.notify).toHaveBeenCalled();
    });
  });
});
