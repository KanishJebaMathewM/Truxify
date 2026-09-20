import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getProfile, getProfileById } from '../../src/services/profileService.js';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const mockEqProfileMaybeSingle = vi.fn();
const mockEqOrders = vi.fn();
const mockEqDriverMaybeSingle = vi.fn();
const supabaseRef = vi.hoisted(() => ({ current: null }));

const defaultMockSupabase = {
  from: vi.fn((table) => {
    if (table === 'profiles') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: mockEqProfileMaybeSingle,
          })),
        })),
      };
    }
    if (table === 'orders') {
      return {
        select: vi.fn(() => ({
          eq: mockEqOrders,
        })),
      };
    }
    if (table === 'driver_details') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: mockEqDriverMaybeSingle,
          })),
        })),
      };
    }
    return { select: vi.fn() };
  }),
};

supabaseRef.current = defaultMockSupabase;
const useMockSupabase = () => {
  supabaseRef.current = defaultMockSupabase;
};

const profileCacheRef = vi.hoisted(() => ({
  getCachedSupabaseProfile: vi.fn().mockResolvedValue(null),
  setCachedSupabaseProfile: vi.fn().mockResolvedValue(undefined),
  getCachedCustomerStats: vi.fn().mockResolvedValue(null),
  setCachedCustomerStats: vi.fn().mockResolvedValue(undefined),
  getCachedDriverDetails: vi.fn().mockResolvedValue(null),
  setCachedDriverDetails: vi.fn().mockResolvedValue(undefined),
  isValidCachedProfile: vi.fn().mockReturnValue(true),
}));

vi.mock('../../src/config/db.js', () => ({
  get supabase() {
    return supabaseRef.current;
  },
  get supabaseAdmin() {
    return supabaseRef.current;
  },
}));

vi.mock('../../src/lib/profileCache.js', () => profileCacheRef);

