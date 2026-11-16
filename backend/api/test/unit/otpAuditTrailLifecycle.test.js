import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

const mockSupabaseAdmin = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

vi.mock('../../src/config/db.js', () => ({
  supabaseAdmin: mockSupabaseAdmin,
  supabase: mockSupabaseAdmin,
  redisClient: null,
}));

import {
  invalidatePreviousOtps,
  requestOtp,
  checkOtpRateLimit,
  markOtpVerified,
  OTP_CONFIG,
} from '../../src/services/otpService.js';

describe('OTP Audit Trail & Lifecycle (#16055)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('invalidatePreviousOtps', () => {
    it('sets is_active=false without setting verified=true, preserving audit trail', async () => {
      let updatePayload = null;
      const eqFilters = [];

      const queryChain = {
        update: vi.fn((data) => {
          updatePayload = data;
          return queryChain;
        }),
        eq: vi.fn((col, val) => {
          eqFilters.push([col, val]);
          return queryChain;
        }),
        then: (resolve) => resolve({ error: null }),
      };

      mockSupabaseAdmin.from.mockReturnValue(queryChain);

      await invalidatePreviousOtps('+919999999999');

      expect(mockSupabaseAdmin.from).toHaveBeenCalledWith('phone_otps');
      expect(updatePayload).toBeDefined();
      expect(updatePayload.is_active).toBe(false);
      expect(updatePayload.invalidated_reason).toBe('superseded');
      expect(updatePayload.invalidated_at).toBeDefined();
      expect(updatePayload.verified).toBeUndefined(); // Crucial: verified column is untouched!

      expect(eqFilters).toContainEqual(['phone', '+919999999999']);
      expect(eqFilters).toContainEqual(['is_active', true]);
      expect(eqFilters).toContainEqual(['verified', false]);
    });

    it('throws error when database update fails to protect single-active invariant', async () => {
      const dbError = new Error('Database connection failed');
      const queryChain = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        then: (resolve) => resolve({ error: dbError }),
      };

      mockSupabaseAdmin.from.mockReturnValue(queryChain);

      await expect(invalidatePreviousOtps('+919999999999')).rejects.toThrow('Database connection failed');
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('requestOtp supersession', () => {
    it('invalidates previous active OTPs before inserting a new active OTP', async () => {
      const operations = [];

      mockSupabaseAdmin.from.mockImplementation((table) => {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              gte: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
          update: vi.fn((data) => {
            operations.push({ op: 'update', data });
            return {
              eq: vi.fn().mockReturnThis(),
              then: (resolve) => resolve({ error: null }),
            };
          }),
          insert: vi.fn((rows) => {
            operations.push({ op: 'insert', rows });
            return {
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'new-otp-uuid-1' },
                  error: null,
                }),
              }),
            };
          }),
        };
      });

      const res = await requestOtp('+919876543210');

      expect(res.success).toBe(true);
      expect(res.otpId).toBe('new-otp-uuid-1');

      // Verify execution order: update (invalidation) MUST happen before insert
      expect(operations.length).toBeGreaterThanOrEqual(2);
      expect(operations[0].op).toBe('update');
      expect(operations[0].data.is_active).toBe(false);
      expect(operations[0].data.invalidated_reason).toBe('superseded');

      expect(operations[1].op).toBe('insert');
      expect(operations[1].rows[0].is_active).toBe(true);
      expect(operations[1].rows[0].verified).toBe(false);
    });

    it('fails safely without inserting new OTP if invalidation fails', async () => {
      let insertCalled = false;

      mockSupabaseAdmin.from.mockImplementation(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            gte: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnThis(),
          then: (resolve) => resolve({ error: new Error('Lock timeout') }),
        }),
        insert: vi.fn(() => {
          insertCalled = true;
          return {
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: 'x' }, error: null }),
            }),
          };
        }),
      }));

      const res = await requestOtp('+919876543210');

      expect(res.success).toBe(false);
      expect(res.error).toBe('DATABASE_ERROR');
      expect(insertCalled).toBe(false); // Did not insert while prior OTP could still be active
    });
  });

  describe('checkOtpRateLimit', () => {
    it('counts all requests in the time window without filtering on is_active', async () => {
      const selectCalls = [];
      const eqCalls = [];

      mockSupabaseAdmin.from.mockReturnValue({
        select: vi.fn((cols) => {
          selectCalls.push(cols);
          return {
            eq: vi.fn((col, val) => {
              eqCalls.push([col, val]);
              return {
                gte: vi.fn().mockResolvedValue({
                  data: [
                    { id: '1', created_at: new Date().toISOString() },
                    { id: '2', created_at: new Date().toISOString() },
                    { id: '3', created_at: new Date().toISOString() },
                  ],
                  error: null,
                }),
              };
            }),
          };
        }),
      });

      const res = await checkOtpRateLimit('+919876543210');

      expect(res.allowed).toBe(false);
      expect(res.reason).toBe('RATE_LIMIT_EXCEEDED');

      // Assert that we did NOT filter by is_active=true in rate limiting
      const hasIsActiveFilter = eqCalls.some(([col]) => col === 'is_active');
      expect(hasIsActiveFilter).toBe(false);
    });
  });

  describe('markOtpVerified', () => {
    it('sets verified=true and deactivates OTP so it cannot be reused', async () => {
      let updatePayload = null;
      let targetId = null;

      mockSupabaseAdmin.from.mockReturnValue({
        update: vi.fn((data) => {
          updatePayload = data;
          return {
            eq: vi.fn((col, val) => {
              if (col === 'id') targetId = val;
              return Promise.resolve({ error: null });
            }),
          };
        }),
      });

      await markOtpVerified('otp-record-123');

      expect(updatePayload).toBeDefined();
      expect(updatePayload.verified).toBe(true);
      expect(updatePayload.is_active).toBe(false);
      expect(updatePayload.verified_at).toBeDefined();
      expect(targetId).toBe('otp-record-123');
    });
  });
});
