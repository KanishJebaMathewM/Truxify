import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OTP_TTL_MINUTES, OTP_MAX_FAILED_ATTEMPTS, OTP_LOCKOUT_MINUTES, checkOtpLockout, recordOtpFailure, clearOtpState } from '../../src/services/order/orderNotificationService.js';

const mockSendPushNotification = vi.fn();
vi.mock('../../src/services/notificationService.js', () => ({
  sendPushNotification: (...args) => mockSendPushNotification(...args),
}));
vi.mock('../../src/middleware/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../src/config/db.js', () => ({ redisClient: null }));

describe('orderNotificationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('exports', () => {
    it('exports OTP_TTL_MINUTES as a number', () => {
      expect(typeof OTP_TTL_MINUTES).toBe('number');
    });

    it('exports OTP_MAX_FAILED_ATTEMPTS as a number', () => {
      expect(typeof OTP_MAX_FAILED_ATTEMPTS).toBe('number');
    });

    it('exports OTP_LOCKOUT_MINUTES as a number', () => {
      expect(typeof OTP_LOCKOUT_MINUTES).toBe('number');
    });

    it('exports checkOtpLockout as a function', () => {
      expect(typeof checkOtpLockout).toBe('function');
    });

    it('exports recordOtpFailure as a function', () => {
      expect(typeof recordOtpFailure).toBe('function');
    });

    it('exports clearOtpState as a function', () => {
      expect(typeof clearOtpState).toBe('function');
    });
  });

  describe('checkOtpLockout', () => {
    it('returns false when redis is not available', async () => {
      const result = await checkOtpLockout('order-1');
      expect(result).toBe(false);
    });
  });
});