import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const helpers = vi.hoisted(() => {
  const mockEqProfileMaybeSingle = vi.fn();
  const mockEqOrders = vi.fn();
  const mockEqDriverMaybeSingle = vi.fn();
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
  return {
    mockEqProfileMaybeSingle,
    mockEqOrders,
    mockEqDriverMaybeSingle,
    defaultMockSupabase,
    supabaseRef: { current: null },
  };
});

helpers.supabaseRef.current = helpers.defaultMockSupabase;

vi.mock('../../src/config/db.js', () => ({
  get supabase() {
    return helpers.supabaseRef.current;
  },
  get supabaseAdmin() {
    return helpers.supabaseRef.current;
  },
}));

const profileCacheRef = vi.hoisted(() => ({
  getCachedSupabaseProfile: vi.fn().mockResolvedValue(null),
  setCachedSupabaseProfile: vi.fn().mockResolvedValue(undefined),
  getCachedCustomerStats: vi.fn().mockResolvedValue(null),
  setCachedCustomerStats: vi.fn().mockResolvedValue(undefined),
  getCachedDriverDetails: vi.fn().mockResolvedValue(null),
  setCachedDriverDetails: vi.fn().mockResolvedValue(undefined),
  isValidCachedProfile: vi.fn().mockReturnValue(true),
}));

vi.mock('../../src/lib/profileCache.js', () => profileCacheRef);

import { getProfile } from '../../src/services/profileService.js';

describe('getProfile', () => {
  beforeEach(() => {
    helpers.supabaseRef.current = helpers.defaultMockSupabase;
    vi.clearAllMocks();
    process.env.CACHE_ENABLED = 'true';
  });

  afterEach(() => {
    delete process.env.CACHE_ENABLED;
  });

  it('throws when supabase is not configured', async () => {
    vi.resetModules();
    helpers.supabaseRef.current = null;
    const { getProfile: getProfileWithoutDb } = await import(
      '../../src/services/profileService.js'
    );
    await expect(getProfileWithoutDb('user-123')).rejects.toThrow(
      'Supabase client not configured',
    );
  });

  it('returns profile data on successful query', async () => {
    const mockData = {
      id: 'user-123',
      firebase_uid: 'fb-uid',
      role: 'driver',
      full_name: 'John',
      phone: '+919876543210',
    };
    helpers.mockEqProfileMaybeSingle.mockResolvedValueOnce({
      data: mockData,
      error: null,
    });
    const result = await getProfile('user-123');
    expect(result).toEqual(mockData);
  });

  it('throws when supabase query returns an error', async () => {
    helpers.mockEqProfileMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'Permission denied' },
    });
    await expect(getProfile('user-123')).rejects.toThrow('Permission denied');
  });

  it('returns null when no matching profile is found', async () => {
    helpers.supabaseRef.current = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    const result = await getProfile('nonexistent-user');
    expect(result).toBeNull();
  });
});