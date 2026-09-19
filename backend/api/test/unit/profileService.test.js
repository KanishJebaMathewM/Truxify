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

describe('profileService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMockSupabase();
  });

  describe('getProfile', () => {
    it('returns profile data from database when cache misses', async () => {
      const mockProfile = { id: 'user-123', full_name: 'Test User' };
      mockEqProfileMaybeSingle.mockResolvedValueOnce({ data: mockProfile, error: null });

      const result = await getProfile('user-123');
      expect(result).toEqual(mockProfile);
      expect(profileCacheRef.setCachedSupabaseProfile).toHaveBeenCalledWith('user-123', mockProfile);
    });

    it('returns null when profile does not exist in database', async () => {
      mockEqProfileMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

      const result = await getProfile('non-existent');
      expect(result).toBeNull();
    });

    it('throws an error when Supabase returns an error (not fake data)', async () => {
      mockEqProfileMaybeSingle.mockResolvedValueOnce({ data: null, error: new Error('connection refused') });

      await expect(getProfile('user-123')).rejects.toThrow('connection refused');
    });

    it('returns cached profile when cache hit is valid', async () => {
      const cachedProfile = { id: 'user-123', full_name: 'Cached User' };
      profileCacheRef.getCachedSupabaseProfile.mockResolvedValueOnce(cachedProfile);
      profileCacheRef.isValidCachedProfile.mockReturnValueOnce(true);

      const result = await getProfile('user-123');
      expect(result).toEqual(cachedProfile);
      expect(mockEqProfileMaybeSingle).not.toHaveBeenCalled();
    });
  });

  describe('getProfileById', () => {
    it('returns null for invalid, non-string, or empty userId', async () => {
      expect(await getProfileById(null)).toBeNull();
      expect(await getProfileById(undefined)).toBeNull();
      expect(await getProfileById('')).toBeNull();
      expect(await getProfileById('   ')).toBeNull();
      expect(await getProfileById(123)).toBeNull();
    });

    it('calls getProfile for valid userId', async () => {
      const mockProfile = { id: 'user-123', full_name: 'Test User' };
      mockEqProfileMaybeSingle.mockResolvedValueOnce({ data: mockProfile, error: null });

      const result = await getProfileById('user-123');
      expect(result).toEqual(mockProfile);
    });
  });
});

