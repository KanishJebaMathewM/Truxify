import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/db.js', () => ({ redisClient: null }));
vi.mock('../../src/middleware/logger.js', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../../src/services/notificationService.js', () => ({
  sendDeliveryOtpNotification: vi.fn(), storeDeliveryOtp: vi.fn(), getActiveDeliveryOtp: vi.fn(),
}));

async function load(capacity) {
  vi.resetModules();
  vi.stubEnv('IN_MEMORY_OTP_MAP_MAX_SIZE', String(capacity));
  vi.stubEnv('OTP_MAX_FAILED_ATTEMPTS', '5');
  vi.stubEnv('OTP_LOCKOUT_MINUTES', '30');
  return import('../../src/services/order/orderNotificationService.js');
}

afterEach(() => vi.unstubAllEnvs());

describe('OTP failure updates at fallback capacity', () => {
  it.each([1, 2])('retains repeated failures and reaches lockout at capacity %i', async capacity => {
    const { recordOtpFailure, checkOtpLockout } = await load(capacity);
    expect(await recordOtpFailure('target')).toBe(1);
    for (let i = 1; i < capacity; i++) await recordOtpFailure(`other-${i}`);
    for (let attempt = 2; attempt <= 5; attempt++) {
      expect(await recordOtpFailure('target')).toBe(attempt);
    }
    expect(await checkOtpLockout('target')).toBe(true);
  });

  it('does not discard another order when updating an existing entry', async () => {
    const { recordOtpFailure } = await load(2);
    expect(await recordOtpFailure('first')).toBe(1);
    expect(await recordOtpFailure('second')).toBe(1);
    expect(await recordOtpFailure('second')).toBe(2);
    expect(await recordOtpFailure('first')).toBe(2);
  });
});
