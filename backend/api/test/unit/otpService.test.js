import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

const { mockRedis } = vi.hoisted(() => ({
  mockRedis: {
    set: vi.fn(),
    get: vi.fn(),
    del: vi.fn(),
  },
}));

vi.mock('../../src/config/db.js', () => ({
  redisClient: mockRedis,
}));

import { generateAndStoreOtp, verifyOtp } from '../../src/services/otpService.js';

describe('otpService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateAndStoreOtp', () => {
    it('generates a 4-digit string and stores its SHA-256 hash in Redis with TTL', async () => {
      mockRedis.set.mockResolvedValue('OK');

      const phone = '+919876543210';
      const otp = await generateAndStoreOtp(phone);

      expect(typeof otp).toBe('string');
      expect(otp).toHaveLength(4);
      expect(/^\d{4}$/.test(otp)).toBe(true);

      const expectedHash = crypto.createHash('sha256').update(otp).digest('hex');
      expect(mockRedis.set).toHaveBeenCalledTimes(1);
      expect(mockRedis.set).toHaveBeenCalledWith(`otp:${phone}`, expectedHash, 'EX', 300);
    });
  });

  describe('verifyOtp', () => {
    it('returns true and deletes the key when the provided OTP matches the stored hash', async () => {
      const phone = '+919876543210';
      const plainOtp = '4821';
      const storedHash = crypto.createHash('sha256').update(plainOtp).digest('hex');

      mockRedis.get.mockResolvedValue(storedHash);
      mockRedis.del.mockResolvedValue(1);

      const isValid = await verifyOtp(phone, plainOtp);
      expect(isValid).toBe(true);
      expect(mockRedis.get).toHaveBeenCalledWith(`otp:${phone}`);
      expect(mockRedis.del).toHaveBeenCalledWith(`otp:${phone}`);
    });

    it('returns false when no OTP is stored in Redis', async () => {
      mockRedis.get.mockResolvedValue(null);

      const isValid = await verifyOtp('+919876543210', '1234');
      expect(isValid).toBe(false);
      expect(mockRedis.del).not.toHaveBeenCalled();
    });

    it('returns false when the provided OTP does not match the stored hash', async () => {
      const phone = '+919876543210';
      const actualHash = crypto.createHash('sha256').update('9999').digest('hex');

      mockRedis.get.mockResolvedValue(actualHash);

      const isValid = await verifyOtp(phone, '1111');
      expect(isValid).toBe(false);
      expect(mockRedis.del).not.toHaveBeenCalled();
    });
  });
});
