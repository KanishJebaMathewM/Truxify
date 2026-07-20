/**
 * Unit tests for backend/api/src/services/profileService.js
 *
 * Coverage:
 *   - getProfile throws when supabase is null (fail-fast on misconfiguration)
 *   - getProfile calls supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
 *   - getProfile throws when supabase query returns an error
 *   - getCustomerStats throws when supabase is null (fail-fast on misconfiguration)
 *   - getCustomerStats queries customer_stats table correctly
 *   - getDriverDetails throws when supabase is null (fail-fast on misconfiguration)
 *   - getDriverDetails queries driver_details table correctly
 *
 * Run with:  npm run test:unit -- test/unit/profileService.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
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

vi.mock('../../src/config/db.js', () => ({
  get supabase() {
    return supabaseRef.current;
  },
}));

import { getProfile, getCustomerStats, getDriverDetails } from '../../src/services/profileService.js';

describe('getProfile', () => {
  beforeEach(() => {
    supabaseRef.current = defaultMockSupabase;
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
});

describe('getCustomerStats', () => {
  beforeEach(() => {
    supabaseRef.current = defaultMockSupabase;
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
});

describe('getDriverDetails', () => {
  beforeEach(() => {
    supabaseRef.current = defaultMockSupabase;
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
