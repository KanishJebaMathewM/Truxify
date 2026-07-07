/**
 * Unit tests for backend/api/src/services/otpService.js
 *
 * Coverage:
 *   - generateAndStoreOtp: generates a 6-digit OTP and stores it in Redis
 *   - generateAndStoreOtp: returns null when Redis is unavailable
 *   - verifyOtp: returns true and deletes the OTP when the correct OTP is provided
 *   - verifyOtp: returns false when the wrong OTP is provided
 *   - verifyOtp: returns false when no OTP is stored
 *   - verifyOtp: returns false when Redis is unavailable in production
 *   - verifyOtp: returns false when Redis is unavailable in non-production
 *
 * Run with:  npm run test:unit -- test/unit/otpService.test.js
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockRedisClient = vi.hoisted(() => ({
  set: vi.fn(),
  get: vi.fn(),
  del: vi.fn(),
}));

// Mutable holder so individual tests can flip redisClient to null
// to simulate Redis being unavailable, then restore it.
const mockDbState = vi.hoisted(() => ({
  redisClient: null,
}));

vi.mock('../../src/config/db.js', () => ({
  get redisClient() {
    return mockDbState.redisClient;
  },
}));

const mockLogger = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

import { generateAndStoreOtp, verifyOtp } from '../../src/services/otpService.js';

describe('otpService — generateAndStoreOtp', () => {
  let originalNodeEnv;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbState.redisClient = mockRedisClient;
    originalNodeEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('generates a 6-digit OTP and stores it in Redis', async () => {
    mockRedisClient.set.mockResolvedValueOnce('OK');
    const otp = await generateAndStoreOtp('+919876543210');

    expect(otp).toMatch(/^\d{6}$/);
    expect(mockRedisClient.set).toHaveBeenCalledWith(
      'otp:+919876543210',
      otp,
      'EX',
      300
    );
  });

  it('returns null when Redis is unavailable', async () => {
    mockDbState.redisClient = null;
    const result = await generateAndStoreOtp('+919876543210');

    expect(result).toBeNull();
  });
});

describe('otpService — verifyOtp', () => {
  let originalNodeEnv;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbState.redisClient = mockRedisClient;
    originalNodeEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('returns true and deletes the OTP when the correct OTP is provided', async () => {
    mockRedisClient.get.mockResolvedValueOnce('1234');
    mockRedisClient.del.mockResolvedValueOnce(1);
    const result = await verifyOtp('+919876543210', '1234');

    expect(result).toBe(true);
    expect(mockRedisClient.del).toHaveBeenCalledWith('otp:+919876543210');
  });

  it('returns false when the wrong OTP is provided', async () => {
    mockRedisClient.get.mockResolvedValueOnce('1234');
    const result = await verifyOtp('+919876543210', '5678');

    expect(result).toBe(false);
    expect(mockRedisClient.del).not.toHaveBeenCalled();
  });

  it('returns false when no OTP is stored', async () => {
    mockRedisClient.get.mockResolvedValueOnce(null);
    const result = await verifyOtp('+919876543210', '1234');

    expect(result).toBe(false);
    expect(mockRedisClient.del).not.toHaveBeenCalled();
  });

  it('returns false when Redis is unavailable in production', async () => {
    process.env.NODE_ENV = 'production';
    mockDbState.redisClient = null;
    const result = await verifyOtp('+919876543210', '1234');

    expect(result).toBe(false);
  });

  it('returns false when Redis is unavailable in non-production', async () => {
    process.env.NODE_ENV = 'development';
    mockDbState.redisClient = null;
    const result = await verifyOtp('+919876543210', '1234');

    expect(result).toBe(false);
  });
});