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

// supabaseRef is an object whose .current property we mutate in beforeEach.
// vi.mock runs once; the factory captures a live reference to supabaseRef so
// the module always sees the current value when it reads supabase.current.
const supabaseRef = vi.hoisted(() => ({ current: null }));

vi.mock('../../src/config/db.js', () => ({
  get supabase() { return supabaseRef.current; },
}));
vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { getProfile, getCustomerStats, getDriverDetails } from '../../src/services/profileService.js';

describe('getProfile', () => {
  beforeEach(() => {
    supabaseRef.current = null;
  });

  it('throws when supabase is not configured', async () => {
    await expect(getProfile('user-123')).rejects.toThrow('Supabase client not configured');
  });

  it('calls supabase.from("profiles").select("*").eq("id", userId).maybeSingle()', async () => {
    const maybeSingleSpy = vi.fn().mockResolvedValue({ data: { id: 'user-123', role: 'driver' }, error: null });
    supabaseRef.current = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: maybeSingleSpy,
    };
    const result = await getProfile('user-123');
    expect(supabaseRef.current.from).toHaveBeenCalledWith('profiles');
    expect(supabaseRef.current.select).toHaveBeenCalledWith('*');
    expect(supabaseRef.current.eq).toHaveBeenCalledWith('id', 'user-123');
    expect(maybeSingleSpy).toHaveBeenCalled();
    expect(result.role).toBe('driver');
  });

  it('throws when supabase query returns an error', async () => {
    supabaseRef.current = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
    };
    await expect(getProfile('user-123')).rejects.toThrow('DB error');
  });
});

describe('getCustomerStats', () => {
  beforeEach(() => {
    supabaseRef.current = null;
  });

  it('throws when supabase is not configured', async () => {
    await expect(getCustomerStats('user-123')).rejects.toThrow('Supabase client not configured');
  });

  it('calls supabase.from("customer_stats").select("*").eq("user_id", userId).maybeSingle()', async () => {
    const maybeSingleSpy = vi.fn().mockResolvedValue({ data: { total_orders: 42 }, error: null });
    supabaseRef.current = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: maybeSingleSpy,
    };
    await getCustomerStats('user-456');
    expect(supabaseRef.current.from).toHaveBeenCalledWith('customer_stats');
    expect(supabaseRef.current.eq).toHaveBeenCalledWith('user_id', 'user-456');
  });

  it('throws when supabase returns an error', async () => {
    supabaseRef.current = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: 'Table not found' } }),
    };
    await expect(getCustomerStats('user-123')).rejects.toThrow('Table not found');
  });
});

describe('getDriverDetails', () => {
  beforeEach(() => {
    supabaseRef.current = null;
  });

  it('throws when supabase is not configured', async () => {
    await expect(getDriverDetails('driver-789')).rejects.toThrow('Supabase client not configured');
  });

  it('calls supabase.from("driver_details").select("*").eq("user_id", userId).maybeSingle()', async () => {
    const maybeSingleSpy = vi.fn().mockResolvedValue({ data: { rating: 4.8 }, error: null });
    supabaseRef.current = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: maybeSingleSpy,
    };
    await getDriverDetails('driver-999');
    expect(supabaseRef.current.from).toHaveBeenCalledWith('driver_details');
    expect(supabaseRef.current.eq).toHaveBeenCalledWith('user_id', 'driver-999');
  });

  it('throws when supabase returns an error', async () => {
    supabaseRef.current = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: 'Query failed' } }),
    };
    await expect(getDriverDetails('driver-123')).rejects.toThrow('Query failed');
  });
});
