/**
 * Unit tests for backend/api/src/services/otpService.js
 *
 * Run with:  npm run test:unit -- test/unit/otpService.test.js
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('otpService', () => {
  let mockRedisClient;
  let originalNodeEnv;

  beforeEach(() => {
    mockRedisClient = {
      set: vi.fn().mockResolvedValue('OK'),
      get: vi.fn(),
      del: vi.fn().mockResolvedValue(1),
    };
    vi.doMock('../../src/config/db.js', () => ({
      redisClient: mockRedisClient,
    }));
    originalNodeEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    vi.resetModules();
  });

  it('generateAndStoreOtp generates a 4-digit OTP and stores it in Redis', async () => {
    const { generateAndStoreOtp } = await import('../../src/services/otpService.js');
    const otp = await generateAndStoreOtp('+919876543210');

    expect(otp).toMatch(/^\d{4}$/);
    expect(mockRedisClient.set).toHaveBeenCalledWith(
      'otp:+919876543210',
      otp,
      'EX',
      300
    );
  });

  it('generateAndStoreOtp returns null when Redis is unavailable', async () => {
    vi.doMock('../../src/config/db.js', () => ({
      redisClient: null,
    }));
    const { generateAndStoreOtp } = await import('../../src/services/otpService.js');
    const result = await generateAndStoreOtp('+919876543210');

    expect(result).toBeNull();
  });

  it('verifyOtp returns true when the correct OTP is provided', async () => {
    mockRedisClient.get.mockResolvedValue('1234');
    const { verifyOtp } = await import('../../src/services/otpService.js');
    const result = await verifyOtp('+919876543210', '1234');

    expect(result).toBe(true);
    expect(mockRedisClient.del).toHaveBeenCalledWith('otp:+919876543210');
  });

  it('verifyOtp returns false when the wrong OTP is provided', async () => {
    mockRedisClient.get.mockResolvedValue('1234');
    const { verifyOtp } = await import('../../src/services/otpService.js');
    const result = await verifyOtp('+919876543210', '5678');

    expect(result).toBe(false);
    expect(mockRedisClient.del).not.toHaveBeenCalled();
  });

  it('verifyOtp returns false when no OTP is stored', async () => {
    mockRedisClient.get.mockResolvedValue(null);
    const { verifyOtp } = await import('../../src/services/otpService.js');
    const result = await verifyOtp('+919876543210', '1234');

    expect(result).toBe(false);
    expect(mockRedisClient.del).not.toHaveBeenCalled();
  });

  it('verifyOtp deletes the OTP after successful verification', async () => {
    mockRedisClient.get.mockResolvedValue('4321');
    const { verifyOtp } = await import('../../src/services/otpService.js');
    await verifyOtp('+919876543210', '4321');

    expect(mockRedisClient.del).toHaveBeenCalledWith('otp:+919876543210');
  });

  it('verifyOtp returns false when Redis is unavailable in production', async () => {
    process.env.NODE_ENV = 'production';
    vi.doMock('../../src/config/db.js', () => ({
      redisClient: null,
    }));
    const { verifyOtp } = await import('../../src/services/otpService.js');
    const result = await verifyOtp('+919876543210', '1234');

    expect(result).toBe(false);
  });

  it('verifyOtp returns false when Redis is unavailable in non-production', async () => {
    process.env.NODE_ENV = 'development';
    vi.doMock('../../src/config/db.js', () => ({
      redisClient: null,
    }));
    const { verifyOtp } = await import('../../src/services/otpService.js');
    const result = await verifyOtp('+919876543210', '1234');

    expect(result).toBe(false);
  });
});
