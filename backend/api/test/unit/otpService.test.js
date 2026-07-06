/**
 * Unit tests for backend/api/src/services/otpService.js
 *
 * Run with:  npm run test:unit -- test/unit/otpService.test.js
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let mockRedis = null;

vi.mock('../../src/config/db.js', () => ({
  get redisClient() { return mockRedis; },
}));

import { generateAndStoreOtp, verifyOtp } from '../../src/services/otpService.js';

describe('otpService', () => {
  let activeRedisClient;
  let originalNodeEnv;

  beforeEach(() => {
    activeRedisClient = {
      set: vi.fn().mockResolvedValue('OK'),
      get: vi.fn(),
      del: vi.fn().mockResolvedValue(1),
    };
    mockRedis = activeRedisClient;
    originalNodeEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    mockRedis = null;
  });

  it('generateAndStoreOtp generates a 4-digit OTP and stores it in Redis', async () => {
    const otp = await generateAndStoreOtp('+919876543210');

    expect(otp).toMatch(/^\d{6}$/);
    expect(mockRedis.set).toHaveBeenCalledWith(
      'otp:+919876543210',
      otp,
      'EX',
      300
    );
  });

  it('generateAndStoreOtp returns null when Redis is unavailable', async () => {
    vi.resetModules();
    vi.doMock('../../src/config/db.js', () => ({
      redisClient: null,
    }));
    const { generateAndStoreOtp } = await import('../../src/services/otpService.js');
    const result = await generateAndStoreOtp('+919876543210');

    expect(result).toBeNull();
  });

  it('verifyOtp returns true when the correct OTP is provided', async () => {
    activeRedisClient.get.mockResolvedValue('1234');
    const result = await verifyOtp('+919876543210', '1234');

    expect(result).toBe(true);
    expect(activeRedisClient.del).toHaveBeenCalledWith('otp:+919876543210');
  });

  it('verifyOtp returns false when the wrong OTP is provided', async () => {
    activeRedisClient.get.mockResolvedValue('1234');
    const result = await verifyOtp('+919876543210', '5678');

    expect(result).toBe(false);
    expect(activeRedisClient.del).not.toHaveBeenCalled();
  });

  it('verifyOtp returns false when no OTP is stored', async () => {
    activeRedisClient.get.mockResolvedValue(null);
    const result = await verifyOtp('+919876543210', '1234');

    expect(result).toBe(false);
    expect(activeRedisClient.del).not.toHaveBeenCalled();
  });

  it('verifyOtp deletes the OTP after successful verification', async () => {
    activeRedisClient.get.mockResolvedValue('4321');
    await verifyOtp('+919876543210', '4321');

    expect(activeRedisClient.del).toHaveBeenCalledWith('otp:+919876543210');
  });

  it('verifyOtp returns false when Redis is unavailable in production', async () => {
    process.env.NODE_ENV = 'production';
    vi.resetModules();
    vi.doMock('../../src/config/db.js', () => ({
      redisClient: null,
    }));
    const { verifyOtp } = await import('../../src/services/otpService.js');
    const result = await verifyOtp('+919876543210', '1234');

    expect(result).toBe(false);
  });

  it('verifyOtp returns false when Redis is unavailable in non-production', async () => {
    process.env.NODE_ENV = 'development';
    vi.resetModules();
    vi.doMock('../../src/config/db.js', () => ({
      redisClient: null,
    }));
    const { verifyOtp } = await import('../../src/services/otpService.js');
    const result = await verifyOtp('+919876543210', '1234');

    expect(result).toBe(false);
  });
});
