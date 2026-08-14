import { describe, it, expect, vi, beforeEach } from 'vitest';

const { dbMock } = vi.hoisted(() => ({
  dbMock: { redisClient: null },
}));

vi.mock('../../src/config/db.js', () => ({
  get redisClient() { return dbMock.redisClient; },
  get supabase() { return null; },
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/services/notificationService.js', () => ({
  sendDeliveryOtpNotification: vi.fn(),
  storeDeliveryOtp: vi.fn(),
  getActiveDeliveryOtp: vi.fn(),
}));

import {
  OTP_TTL_MINUTES,
  OTP_MAX_FAILED_ATTEMPTS,
  OTP_LOCKOUT_MINUTES,
  DELIVERY_OTP_READY_STATUSES,
  checkOtpLockout,
  recordOtpFailure,
  clearOtpState,
} from '../../src/services/order/orderNotificationService.js';

describe('orderNotificationService OTP guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.redisClient = null;
  });

  it('exports expected constants', () => {
    expect(OTP_TTL_MINUTES).toBeGreaterThan(0);
    expect(OTP_MAX_FAILED_ATTEMPTS).toBeGreaterThan(0);
    expect(OTP_LOCKOUT_MINUTES).toBeGreaterThan(0);
    expect(DELIVERY_OTP_READY_STATUSES.has('arriving')).toBe(true);
  });

  describe('checkOtpLockout', () => {
    it('returns false when Redis is unavailable and no memory record exists', async () => {
      expect(await checkOtpLockout('order-1')).toBe(false);
    });

    it('returns true when Redis reports a lock', async () => {
      dbMock.redisClient = { get: vi.fn().mockResolvedValue('1') };
      expect(await checkOtpLockout('order-1')).toBe(true);
    });

    it('returns false when Redis reports no lock', async () => {
      dbMock.redisClient = { get: vi.fn().mockResolvedValue(null) };
      expect(await checkOtpLockout('order-1')).toBe(false);
    });
  });

  describe('recordOtpFailure', () => {
    it('uses in-memory fallback and counts failures', async () => {
      const first = await recordOtpFailure('order-1');
      expect(first).toBe(1);
      const second = await recordOtpFailure('order-1');
      expect(second).toBe(2);
    });

    it('locks after reaching the max attempt threshold', async () => {
      for (let i = 0; i < OTP_MAX_FAILED_ATTEMPTS; i += 1) {
        await recordOtpFailure('order-2');
      }
      expect(await checkOtpLockout('order-2')).toBe(true);
    });
  });

  describe('clearOtpState', () => {
    it('clears the failure count in memory', async () => {
      await recordOtpFailure('order-3');
      await clearOtpState('order-3');
      // The lockout guard key is not deleted; the count resets via a fresh record
      expect(await checkOtpLockout('order-3')).toBe(false);
    });

    it('deletes the count key when Redis is available', async () => {
      const del = vi.fn().mockResolvedValue(1);
      dbMock.redisClient = { del };
      await clearOtpState('order-4');
      expect(del).toHaveBeenCalledWith('otp_failed_count:order-4');
    });
  });
});
