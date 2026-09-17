import { describe, it, expect } from 'vitest';
import { getProfileById } from '../../../src/services/profileService.js';

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
  // No service-role key in tests — the service falls back to the anon mock.
  supabaseAdmin: undefined,
}));

vi.mock('../../src/lib/profileCache.js', () => profileCacheRef);

import { getProfile, getCustomerStats, getDriverDetails } from '../../src/services/profileService.js';

describe('getProfile', () => {
  beforeEach(() => {
    supabaseRef.current = defaultMockSupabase;
    vi.clearAllMocks();
    profileCacheRef.getCachedSupabaseProfile.mockResolvedValue(null);
    profileCacheRef.setCachedSupabaseProfile.mockResolvedValue(undefined);
    process.env.CACHE_ENABLED = 'true';
  });

  afterEach(() => {
    delete process.env.CACHE_ENABLED;
  });

  it('throws when supabase is not configured', async () => {
    supabaseRef.current = null;
    await expect(getProfile('user-123')).rejects.toThrow('Supabase client not configured');
  });

  it('returns profile data on successful query', async () => {
    useMockSupabase();
    const mockData = { id: 'user-123', firebase_uid: 'fb-uid', role: 'driver', full_name: 'John', phone: '+919876543210' };
    mockEqProfileMaybeSingle.mockResolvedValueOnce({ data: mockData, error: null });
    const result = await getProfile('user-123');
    expect(result).toEqual(mockData);
  });

  it('throws when supabase query returns an error', async () => {
    useMockSupabase();
    mockEqProfileMaybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'Permission denied' } });
    await expect(getProfile('user-123')).rejects.toThrow('Permission denied');
  });

  it('returns null when no matching profile is found', async () => {
    supabaseRef.current = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    const result = await getProfile('nonexistent-user');
    expect(result).toBeNull();
  });

  it('getProfileById returns null for invalid id format', async () => {
    const result = await getProfileById('');
    expect(result).toBeNull();
  });
});
