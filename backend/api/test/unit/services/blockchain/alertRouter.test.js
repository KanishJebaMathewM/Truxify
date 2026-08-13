import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

vi.mock('../../../../src/core/performanceMetrics.js', () => ({
  measureExecution: (name, fn) => fn(),
}));

const { default: AlertRouter, SEVERITY_LEVELS } = await import('../../../../src/services/blockchain/alertRouter.js');

function buildRouter() {
  const notificationService = {};
  const slackClient = { sendMessage: vi.fn().mockResolvedValue(undefined) };
  const emailService = { send: vi.fn().mockResolvedValue(undefined) };
  const smsService = { send: vi.fn().mockResolvedValue(undefined) };
  const router = new AlertRouter({ notificationService, slackClient, emailService, smsService });
  return { router, slackClient, emailService, smsService };
}

const CRITICAL_ALERT = {
  type: 'BALANCE_UPDATE_FAILED',
  severity: 'CRITICAL',
  reason: 'insufficient funds',
  wallet: '0xabc',
  txHash: '0xdef',
  blockNumber: 42,
};

describe('AlertRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes CRITICAL alerts to slack, email, and sms', async () => {
    process.env.ALERT_SMS_RECIPIENTS = '+911234567890';
    const { router, slackClient, emailService, smsService } = buildRouter();
    const results = await router.route(CRITICAL_ALERT);

    expect(results).toHaveLength(3);
    expect(slackClient.sendMessage).toHaveBeenCalled();
    expect(emailService.send).toHaveBeenCalled();
    expect(smsService.send).toHaveBeenCalled();
    delete process.env.ALERT_SMS_RECIPIENTS;
  });

  it('routes LOW alerts only to the dashboard', async () => {
    const { router, slackClient, emailService, smsService } = buildRouter();
    await router.route({ type: 'X', severity: 'LOW' });

    expect(slackClient.sendMessage).not.toHaveBeenCalled();
    expect(emailService.send).not.toHaveBeenCalled();
    expect(smsService.send).not.toHaveBeenCalled();
  });

  it('formatSlackMessage includes severity color and reason', () => {
    const { router } = buildRouter();
    const msg = router.formatSlackMessage(CRITICAL_ALERT);
    expect(msg.attachments[0].color).toBe('danger');
    expect(msg.attachments[0].text).toContain('BALANCE_UPDATE_FAILED');
    expect(msg.attachments[0].text).toContain('insufficient funds');
  });

  it('formatEmailBody includes alert details', () => {
    const { router } = buildRouter();
    const body = router.formatEmailBody(CRITICAL_ALERT);
    expect(body).toContain('Alert Type: BALANCE_UPDATE_FAILED');
    expect(body).toContain('Severity: CRITICAL');
    expect(body).toContain('Transaction: 0xdef');
  });

  it('getSeverityColor maps severities', () => {
    const { router } = buildRouter();
    expect(router.getSeverityColor('CRITICAL')).toBe('danger');
    expect(router.getSeverityColor('HIGH')).toBe('warning');
    expect(router.getSeverityColor('MEDIUM')).toBe('good');
    expect(router.getSeverityColor('LOW')).toBe('#808080');
    expect(router.getSeverityColor('UNKNOWN')).toBe('#808080');
  });

  it('does not fail when no channel services are configured', async () => {
    const router = new AlertRouter({});
    const results = await router.route({ type: 'X', severity: 'HIGH' });
    // Slack + email: both no-op because clients are missing.
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
  });

  it('exports severity levels', () => {
    expect(SEVERITY_LEVELS.CRITICAL).toBe('CRITICAL');
  });
});
