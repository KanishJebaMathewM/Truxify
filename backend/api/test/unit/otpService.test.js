import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const dbState = vi.hoisted(() => ({
  rateLimitResult: { data: [], error: null },
  singleResult: { data: { id: 'otp-123' }, error: null },
  updates: [],
  inserts: [],
}));

function makeQuery() {
  const q = {
    select: vi.fn(() => q),
    eq: vi.fn(() => q),
    gte: vi.fn(() => q),
    lt: vi.fn(() => q),
    insert: vi.fn((rows) => {
      dbState.inserts.push(rows);
      return q;
    }),
    update: vi.fn((payload) => {
      dbState.updates.push(payload);
      return q;
    }),
    delete: vi.fn(() => q),
    single: vi.fn(async () => dbState.singleResult),
    then: (resolve, reject) => Promise.resolve(dbState.rateLimitResult).then(resolve, reject),
  };
  return q;
}

vi.mock('../../src/config/db.js', () => ({
  supabaseAdmin: {
    from: vi.fn(() => makeQuery()),
    rpc: vi.fn(),
  },
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: loggerMock,
}));

import {
  OTP_CONFIG,
  generateOtp,
  generateSalt,
  hashOtp,
  verifyOtpHash,
  checkOtpRateLimit,
  requestOtp,
  invalidatePreviousOtps,
} from '../../src/services/otpService.js';

describe('otpService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbState.rateLimitResult = { data: [], error: null };
    dbState.singleResult = { data: { id: 'otp-123' }, error: null };
    dbState.updates = [];
    dbState.inserts = [];
  });

  describe('generateOtp', () => {
    it('generates a zero-padded numeric string of the configured length', () => {
      for (let i = 0; i < 25; i += 1) {
        const otp = generateOtp();
        expect(typeof otp).toBe('string');
        expect(otp).toHaveLength(OTP_CONFIG.LENGTH);
        expect(/^\d+$/.test(otp)).toBe(true);
      }
    });
  });

  describe('generateSalt and hashOtp', () => {
    it('generates hex salts with the default and custom byte lengths', () => {
      expect(generateSalt()).toHaveLength(32);
      expect(generateSalt(8)).toHaveLength(16);
    });

    it('hashes the otp concatenated with the salt', () => {
      const expected = crypto.createHash('sha256').update(`4821${'s4lt'}`).digest('hex');
      expect(hashOtp('4821', 's4lt')).toBe(expected);
    });

    it('refuses to hash without both parts', () => {
      expect(() => hashOtp('', 's4lt')).toThrow('OTP and salt are required');
      expect(() => hashOtp('4821', '')).toThrow('OTP and salt are required');
    });
  });

  describe('verifyOtpHash', () => {
    it('accepts the matching otp and rejects a wrong one', () => {
      const salt = generateSalt();
      const storedHash = hashOtp('4821', salt);
      expect(verifyOtpHash('4821', storedHash, salt)).toBe(true);
      expect(verifyOtpHash('1111', storedHash, salt)).toBe(false);
    });

    it('returns false when any part is missing', () => {
      expect(verifyOtpHash('', 'hash', 'salt')).toBe(false);
      expect(verifyOtpHash('4821', '', 'salt')).toBe(false);
      expect(verifyOtpHash('4821', 'hash', '')).toBe(false);
    });
  });

  describe('checkOtpRateLimit', () => {
    it('allows requests below the per-window maximum', async () => {
      dbState.rateLimitResult = { data: [{ id: 'a' }], error: null };
      await expect(checkOtpRateLimit('+919876543210')).resolves.toEqual({ allowed: true });
    });

    it('blocks requests once the window is exhausted', async () => {
      const created = new Date(Date.now() - 1000).toISOString();
      dbState.rateLimitResult = {
        data: [{ id: 'a', created_at: created }, { id: 'b', created_at: created }, { id: 'c', created_at: created }],
        error: null,
      };
      const result = await checkOtpRateLimit('+919876543210');
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('RATE_LIMIT_EXCEEDED');
      expect(result.retryAfter).toBeGreaterThan(0);
    });
  });

  describe('requestOtp', () => {
    it('rejects phone numbers outside E.164 without touching the database', async () => {
      const result = await requestOtp('9876543210');
      expect(result).toMatchObject({ success: false, error: 'INVALID_PHONE_FORMAT' });
      expect(dbState.inserts).toHaveLength(0);
    });

    it('stores a salted hash and returns the new record id', async () => {
      const result = await requestOtp('+919876543210');

      expect(result).toMatchObject({ success: true, otpId: 'otp-123' });
      expect(result.expiresAt).toBeDefined();
      expect(dbState.inserts).toHaveLength(1);
      const row = dbState.inserts[0][0];
      expect(row.phone).toBe('+919876543210');
      expect(row.is_active).toBe(true);
      expect(row.verified).toBe(false);
      expect(typeof row.otp_hash).toBe('string');
      expect(row.otp_hash).toHaveLength(64);
      expect(typeof row.otp_salt).toBe('string');
      expect(row.otp_salt).toHaveLength(32);
      expect(row.otp_hash).not.toBe(row.otp_salt);
    });

    it('supersedes previous otps without marking them verified', async () => {
      await requestOtp('+919876543210');

      expect(dbState.updates).toHaveLength(1);
      expect(dbState.updates[0]).toMatchObject({
        is_active: false,
        invalidated_reason: 'superseded',
      });
      expect('verified' in dbState.updates[0]).toBe(false);
    });

    it('surfaces the rate limit instead of inserting', async () => {
      const created = new Date(Date.now() - 1000).toISOString();
      dbState.rateLimitResult = {
        data: [{ id: 'a', created_at: created }, { id: 'b', created_at: created }, { id: 'c', created_at: created }],
        error: null,
      };

      const result = await requestOtp('+919876543210');

      expect(result).toMatchObject({ success: false, error: 'RATE_LIMIT_EXCEEDED' });
      expect(dbState.inserts).toHaveLength(0);
    });
  });

  describe('invalidatePreviousOtps', () => {
    it('deactivates active otps while leaving the verified flag alone', async () => {
      await invalidatePreviousOtps('+919876543210');

      expect(dbState.updates).toHaveLength(1);
      expect(dbState.updates[0].is_active).toBe(false);
      expect(dbState.updates[0].invalidated_reason).toBe('superseded');
      expect('verified' in dbState.updates[0]).toBe(false);
    });
  });
});
