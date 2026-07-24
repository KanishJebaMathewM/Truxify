/**
 * Unit tests for backend/api/src/services/profileService.js
 *
 * Coverage:
 *   - getProfile throws when supabase is null (fail-fast on misconfiguration)
 *   - getProfile calls supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
 *   - getProfile throws when supabase query returns an error
 *   - getProfile returns cached data on cache hit (skips DB)
 *   - getProfile falls back to DB when cache read fails
 *   - getProfile populates cache after DB fetch
 *   - getProfile continues when cache write fails
 *   - getCustomerStats throws when supabase is null
 *   - getCustomerStats queries customer_stats table correctly
 *   - getCustomerStats returns cached data on cache hit
 *   - getCustomerStats falls back to DB when cache read fails
 *   - getDriverDetails throws when supabase is null
 *   - getDriverDetails queries driver_details table correctly
 *   - getDriverDetails returns cached data on cache hit
 *   - getDriverDetails falls back to DB when cache read fails
 *   - CACHE_ENABLED=false disables caching entirely
 *
 * Run with:  npm run test:unit -- test/unit/profileService.test.js
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const mockEqProfileMaybeSingle = vi.fn();
const mockEqStatsMaybeSingle = vi.fn();
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
    if (table === 'customer_stats') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: mockEqStatsMaybeSingle,
          })),
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
}));

vi.mock('../../src/config/db.js', () => ({
  get supabase() {
    return supabaseRef.current;
  },
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

  it('returns cached profile on cache hit (skips DB)', async () => {
    const cachedProfile = { id: 'user-123', role: 'driver', full_name: 'Cached John' };
    profileCacheRef.getCachedSupabaseProfile.mockResolvedValueOnce(cachedProfile);

    const result = await getProfile('user-123');
    expect(result).toEqual(cachedProfile);
    expect(profileCacheRef.getCachedSupabaseProfile).toHaveBeenCalledWith('user-123');
    expect(profileCacheRef.setCachedSupabaseProfile).not.toHaveBeenCalled();
  });

  it('falls back to DB when cache read fails', async () => {
    profileCacheRef.getCachedSupabaseProfile.mockRejectedValueOnce(new Error('Redis down'));
    useMockSupabase();
    const mockData = { id: 'user-123', role: 'driver', full_name: 'John' };
    mockEqProfileMaybeSingle.mockResolvedValueOnce({ data: mockData, error: null });

    const result = await getProfile('user-123');
    expect(result).toEqual(mockData);
  });

  it('populates cache after successful DB fetch', async () => {
    useMockSupabase();
    const mockData = { id: 'user-123', role: 'driver', full_name: 'John' };
    mockEqProfileMaybeSingle.mockResolvedValueOnce({ data: mockData, error: null });

    await getProfile('user-123');
    expect(profileCacheRef.setCachedSupabaseProfile).toHaveBeenCalledWith('user-123', mockData);
  });

  it('continues when cache write fails', async () => {
    profileCacheRef.setCachedSupabaseProfile.mockRejectedValueOnce(new Error('Redis write fail'));
    useMockSupabase();
    const mockData = { id: 'user-123', role: 'driver', full_name: 'John' };
    mockEqProfileMaybeSingle.mockResolvedValueOnce({ data: mockData, error: null });

    const result = await getProfile('user-123');
    expect(result).toEqual(mockData);
  });

  it('skips cache when CACHE_ENABLED is false', async () => {
    process.env.CACHE_ENABLED = 'false';
    useMockSupabase();
    const mockData = { id: 'user-123', role: 'driver', full_name: 'John' };
    mockEqProfileMaybeSingle.mockResolvedValueOnce({ data: mockData, error: null });

    const result = await getProfile('user-123');
    expect(result).toEqual(mockData);
    expect(profileCacheRef.getCachedSupabaseProfile).not.toHaveBeenCalled();
    expect(profileCacheRef.setCachedSupabaseProfile).not.toHaveBeenCalled();
  });
});

describe('getCustomerStats', () => {
  beforeEach(() => {
    supabaseRef.current = defaultMockSupabase;
    vi.clearAllMocks();
    profileCacheRef.getCachedCustomerStats.mockResolvedValue(null);
    profileCacheRef.setCachedCustomerStats.mockResolvedValue(undefined);
    process.env.CACHE_ENABLED = 'true';
  });

  afterEach(() => {
    delete process.env.CACHE_ENABLED;
  });

  it('throws when supabase is not configured', async () => {
    supabaseRef.current = null;
    await expect(getCustomerStats('user-123')).rejects.toThrow('Supabase client not configured');
  });

  it('returns customer stats on successful query', async () => {
    useMockSupabase();
    const mockData = { total_orders: 42, total_saved: 8, co2_reduced_kg: 156.5 };
    mockEqStatsMaybeSingle.mockResolvedValueOnce({ data: mockData, error: null });
    const result = await getCustomerStats('user-456');
    expect(result).toEqual(mockData);
  });

  it('throws when supabase query returns an error', async () => {
    useMockSupabase();
    mockEqStatsMaybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'Row not found' } });
    await expect(getCustomerStats('user-456')).rejects.toThrow('Row not found');
  });

  it('returns null when no customer stats are found', async () => {
    supabaseRef.current = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    const result = await getCustomerStats('new-user-without-stats');
    expect(result).toBeNull();
  });

  it('returns cached stats on cache hit', async () => {
    const cachedStats = { total_orders: 10, total_saved: 5, co2_reduced_kg: 2.5 };
    profileCacheRef.getCachedCustomerStats.mockResolvedValueOnce(cachedStats);

    const result = await getCustomerStats('user-456');
    expect(result).toEqual(cachedStats);
    expect(profileCacheRef.getCachedCustomerStats).toHaveBeenCalledWith('user-456');
    expect(profileCacheRef.setCachedCustomerStats).not.toHaveBeenCalled();
  });

  it('falls back to DB when cache read fails', async () => {
    profileCacheRef.getCachedCustomerStats.mockRejectedValueOnce(new Error('Redis down'));
    useMockSupabase();
    const mockData = { total_orders: 42 };
    mockEqStatsMaybeSingle.mockResolvedValueOnce({ data: mockData, error: null });

    const result = await getCustomerStats('user-456');
    expect(result).toEqual(mockData);
  });

  it('populates cache after successful DB fetch', async () => {
    useMockSupabase();
    const mockData = { total_orders: 42 };
    mockEqStatsMaybeSingle.mockResolvedValueOnce({ data: mockData, error: null });

    await getCustomerStats('user-456');
    expect(profileCacheRef.setCachedCustomerStats).toHaveBeenCalledWith('user-456', mockData);
  });
});

describe('getDriverDetails', () => {
  beforeEach(() => {
    supabaseRef.current = defaultMockSupabase;
    vi.clearAllMocks();
    profileCacheRef.getCachedDriverDetails.mockResolvedValue(null);
    profileCacheRef.setCachedDriverDetails.mockResolvedValue(undefined);
    process.env.CACHE_ENABLED = 'true';
  });

  afterEach(() => {
    delete process.env.CACHE_ENABLED;
  });

  it('throws when supabase is not configured', async () => {
    supabaseRef.current = null;
    await expect(getDriverDetails('driver-789')).rejects.toThrow('Supabase client not configured');
  });

  it('returns driver details on successful query', async () => {
    useMockSupabase();
    const mockData = {
      truck_id: 'truck-01', rating: 4.7, total_trips: 150, completion_rate: 0.95,
      is_online: true, wallet_confirmed: 500000, wallet_pending: 12000, wallet_total: 512000,
    };
    mockEqDriverMaybeSingle.mockResolvedValueOnce({ data: mockData, error: null });
    const result = await getDriverDetails('driver-789');
    expect(result).toEqual(mockData);
  });

  it('throws when supabase query returns an error', async () => {
    useMockSupabase();
    mockEqDriverMaybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'Driver profile not found' } });
    await expect(getDriverDetails('driver-789')).rejects.toThrow('Driver profile not found');
  });

  it('returns null when no driver details are found', async () => {
    supabaseRef.current = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    const result = await getDriverDetails('new-driver-without-details');
    expect(result).toBeNull();
  });

  it('returns cached driver details on cache hit', async () => {
    const cachedDetails = { truck_id: 'truck-01', rating: 4.7, total_trips: 150 };
    profileCacheRef.getCachedDriverDetails.mockResolvedValueOnce(cachedDetails);

    const result = await getDriverDetails('driver-789');
    expect(result).toEqual(cachedDetails);
    expect(profileCacheRef.getCachedDriverDetails).toHaveBeenCalledWith('driver-789');
    expect(profileCacheRef.setCachedDriverDetails).not.toHaveBeenCalled();
  });

  it('falls back to DB when cache read fails', async () => {
    profileCacheRef.getCachedDriverDetails.mockRejectedValueOnce(new Error('Redis down'));
    useMockSupabase();
    const mockData = { truck_id: 'truck-01' };
    mockEqDriverMaybeSingle.mockResolvedValueOnce({ data: mockData, error: null });

    const result = await getDriverDetails('driver-789');
    expect(result).toEqual(mockData);
  });

  it('populates cache after successful DB fetch', async () => {
    useMockSupabase();
    const mockData = { truck_id: 'truck-01' };
    mockEqDriverMaybeSingle.mockResolvedValueOnce({ data: mockData, error: null });

    await getDriverDetails('driver-789');
    expect(profileCacheRef.setCachedDriverDetails).toHaveBeenCalledWith('driver-789', mockData);
  });
});

describe('createProfile', () => {
  beforeEach(() => {
    supabaseRef.current = defaultMockSupabase;
  });

  it('throws when supabase is not configured', async () => {
    supabaseRef.current = null;
    const { createProfile } = await import('../../src/services/profileService.js');
    await expect(createProfile({})).rejects.toThrow('Supabase client not configured');
  });

  it('creates profile on successful query', async () => {
    const mockInsertSelectSingle = vi.fn().mockResolvedValue({ data: { id: 'new' }, error: null });
    supabaseRef.current = {
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: mockInsertSelectSingle
          })
        })
      })
    };
    const { createProfile } = await import('../../src/services/profileService.js');
    const result = await createProfile({ name: 'test' });
    expect(result).toEqual({ id: 'new' });
  });
});

describe('updateProfile', () => {
  beforeEach(() => {
    supabaseRef.current = defaultMockSupabase;
  });

  it('throws when supabase is not configured', async () => {
    supabaseRef.current = null;
    const { updateProfile } = await import('../../src/services/profileService.js');
    await expect(updateProfile('id', {})).rejects.toThrow('Supabase client not configured');
  });

  it('updates profile on successful query', async () => {
    const mockUpdateEqSelectSingle = vi.fn().mockResolvedValue({ data: { id: 'id' }, error: null });
    supabaseRef.current = {
      from: vi.fn().mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: mockUpdateEqSelectSingle
            })
          })
        })
      })
    };
    const { updateProfile } = await import('../../src/services/profileService.js');
    const result = await updateProfile('id', { name: 'test' });
    expect(result).toEqual({ id: 'id' });
  });
});
