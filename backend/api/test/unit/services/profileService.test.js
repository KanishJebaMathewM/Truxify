import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const mockFrom = vi.fn();
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockEq = vi.fn();
const mockSingle = vi.fn();
const mockMaybeSingle = vi.fn();

const supabaseAdminRef = vi.hoisted(() => ({ current: null }));
const supabaseAnonRef = vi.hoisted(() => ({ current: null }));

const defaultMockSupabaseAdmin = {
  from: mockFrom,
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

vi.mock('../../../src/config/db.js', () => ({
  get supabase() {
    return supabaseAnonRef.current;
  },
  get supabaseAdmin() {
    return supabaseAdminRef.current;
  },
}));

vi.mock('../../../src/lib/profileCache.js', () => profileCacheRef);

import {
  getProfile,
  getProfileById,
  createProfile,
  updateProfile,
  deleteProfile,
  getCustomerStats,
  getDriverDetails,
  sanitizeProfilePii,
  ProfileService,
} from '../../../src/services/profileService.js';

describe('ProfileService', () => {
  beforeEach(() => {
    supabaseAdminRef.current = defaultMockSupabaseAdmin;
    supabaseAnonRef.current = defaultMockSupabaseAdmin;
    vi.clearAllMocks();

    profileCacheRef.getCachedSupabaseProfile.mockResolvedValue(null);
    profileCacheRef.setCachedSupabaseProfile.mockResolvedValue(undefined);
    profileCacheRef.getCachedCustomerStats.mockResolvedValue(null);
    profileCacheRef.setCachedCustomerStats.mockResolvedValue(undefined);
    profileCacheRef.getCachedDriverDetails.mockResolvedValue(null);
    profileCacheRef.setCachedDriverDetails.mockResolvedValue(undefined);
    profileCacheRef.isValidCachedProfile.mockReturnValue(true);

    process.env.CACHE_ENABLED = 'true';

    mockFrom.mockReset();
    mockSelect.mockReset();
    mockInsert.mockReset();
    mockUpdate.mockReset();
    mockDelete.mockReset();
    mockEq.mockReset();
    mockSingle.mockReset();
    mockMaybeSingle.mockReset();

    mockFrom.mockReturnValue({
      select: mockSelect,
      insert: mockInsert,
      update: mockUpdate,
      delete: mockDelete,
    });
    mockSelect.mockReturnValue({
      eq: mockEq,
      single: mockSingle,
      maybeSingle: mockMaybeSingle,
    });
    mockInsert.mockReturnValue({
      select: mockSelect,
    });
    mockUpdate.mockReturnValue({
      eq: mockEq,
      select: mockSelect,
    });
    mockDelete.mockReturnValue({
      eq: mockEq,
      select: mockSelect,
    });
    mockEq.mockReturnValue({
      select: mockSelect,
      single: mockSingle,
      maybeSingle: mockMaybeSingle,
    });
  });

  afterEach(() => {
    delete process.env.CACHE_ENABLED;
  });

  describe('getProfile', () => {
    it('throws when supabaseAdmin is not configured', async () => {
      supabaseAdminRef.current = null;
      await expect(getProfile('user-123')).rejects.toThrow('Supabase client not configured');
    });

    it('returns cached profile when cache hit is valid', async () => {
      const cachedData = { id: 'user-123', full_name: 'Cached User' };
      profileCacheRef.getCachedSupabaseProfile.mockResolvedValueOnce(cachedData);
      profileCacheRef.isValidCachedProfile.mockReturnValueOnce(true);

      const result = await getProfile('user-123');
      expect(result).toEqual(cachedData);
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it('falls back to database when cache throws an error', async () => {
      profileCacheRef.getCachedSupabaseProfile.mockRejectedValueOnce(new Error('Redis connection error'));
      const dbData = { id: 'user-123', full_name: 'DB User' };
      mockMaybeSingle.mockResolvedValueOnce({ data: dbData, error: null });

      const result = await getProfile('user-123');
      expect(result).toEqual(dbData);
      expect(mockFrom).toHaveBeenCalledWith('profiles');
    });

    it('returns profile from database on cache miss and populates cache', async () => {
      const dbData = { id: 'user-123', full_name: 'DB User' };
      mockMaybeSingle.mockResolvedValueOnce({ data: dbData, error: null });

      const result = await getProfile('user-123');
      expect(result).toEqual(dbData);
      expect(profileCacheRef.setCachedSupabaseProfile).toHaveBeenCalledWith('user-123', dbData);
    });

    it('throws when database query returns an error', async () => {
      mockMaybeSingle.mockResolvedValueOnce({ data: null, error: new Error('DB query failure') });
      await expect(getProfile('user-123')).rejects.toThrow('DB query failure');
    });

    it('returns null when no matching profile is found', async () => {
      mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
      const result = await getProfile('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('getProfileById', () => {
    it('returns null for empty or non-string user IDs', async () => {
      expect(await getProfileById('')).toBeNull();
      expect(await getProfileById('   ')).toBeNull();
      expect(await getProfileById(null)).toBeNull();
      expect(await getProfileById(undefined)).toBeNull();
      expect(await getProfileById(12345)).toBeNull();
    });

    it('delegates to getProfile for valid user ID string', async () => {
      const dbData = { id: 'user-456', full_name: 'Alice' };
      mockMaybeSingle.mockResolvedValueOnce({ data: dbData, error: null });

      const result = await getProfileById('user-456');
      expect(result).toEqual(dbData);
      expect(mockFrom).toHaveBeenCalledWith('profiles');
    });
  });

  describe('createProfile', () => {
    it('throws when supabaseAdmin is not configured', async () => {
      supabaseAdminRef.current = null;
      await expect(createProfile({ id: 'u1' })).rejects.toThrow('Supabase client not configured');
    });

    it('creates profile and returns data on success', async () => {
      const newProfile = { id: 'u1', full_name: 'Bob', role: 'driver' };
      mockSingle.mockResolvedValueOnce({ data: newProfile, error: null });

      const result = await createProfile({ full_name: 'Bob', role: 'driver' });
      expect(mockFrom).toHaveBeenCalledWith('profiles');
      expect(mockInsert).toHaveBeenCalledWith({ full_name: 'Bob', role: 'driver' });
      expect(result).toEqual(newProfile);
    });

    it('throws and logs error when insert fails', async () => {
      mockSingle.mockResolvedValueOnce({ data: null, error: new Error('Unique constraint violated') });
      await expect(createProfile({ full_name: 'Bob' })).rejects.toThrow('Unique constraint violated');
    });
  });

  describe('updateProfile', () => {
    it('throws when supabaseAdmin is not configured', async () => {
      supabaseAdminRef.current = null;
      await expect(updateProfile('u1', { full_name: 'Updated' })).rejects.toThrow('Supabase client not configured');
    });

    it('updates profile and returns updated data on success', async () => {
      const updated = { id: 'u1', full_name: 'Updated Bob' };
      mockSingle.mockResolvedValueOnce({ data: updated, error: null });

      const result = await updateProfile('u1', { full_name: 'Updated Bob' });
      expect(mockFrom).toHaveBeenCalledWith('profiles');
      expect(mockUpdate).toHaveBeenCalledWith({ full_name: 'Updated Bob' });
      expect(mockEq).toHaveBeenCalledWith('id', 'u1');
      expect(result).toEqual(updated);
    });

    it('throws and logs error when update fails', async () => {
      mockSingle.mockResolvedValueOnce({ data: null, error: new Error('Database locked') });
      await expect(updateProfile('u1', { full_name: 'Updated' })).rejects.toThrow('Database locked');
    });
  });

  describe('deleteProfile', () => {
    it('throws when supabaseAdmin is not configured', async () => {
      supabaseAdminRef.current = null;
      await expect(deleteProfile('u1')).rejects.toThrow('Supabase client not configured');
    });

    it('deletes profile and returns deleted record on success', async () => {
      const deleted = { id: 'u1', full_name: 'Deleted User' };
      mockMaybeSingle.mockResolvedValueOnce({ data: deleted, error: null });

      const result = await deleteProfile('u1');
      expect(mockFrom).toHaveBeenCalledWith('profiles');
      expect(mockDelete).toHaveBeenCalled();
      expect(mockEq).toHaveBeenCalledWith('id', 'u1');
      expect(result).toEqual(deleted);
    });

    it('throws and logs error when deletion fails', async () => {
      mockMaybeSingle.mockResolvedValueOnce({ data: null, error: new Error('Foreign key restriction') });
      await expect(deleteProfile('u1')).rejects.toThrow('Foreign key restriction');
    });
  });

  describe('getCustomerStats', () => {
    it('returns cached customer stats when available', async () => {
      const cached = { user_id: 'c1', total_orders: 5, total_saved: 0, co2_reduced_kg: 0 };
      profileCacheRef.getCachedCustomerStats.mockResolvedValueOnce(cached);

      const result = await getCustomerStats('c1');
      expect(result).toEqual(cached);
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it('computes stats from orders table when cache misses', async () => {
      mockEq.mockResolvedValueOnce({
        data: [{ status: 'delivered', total_amount: 5000 }, { status: 'delivered', total_amount: 3000 }],
        error: null,
      });

      const result = await getCustomerStats('c1');
      expect(result).toEqual({
        user_id: 'c1',
        total_orders: 2,
        total_saved: 0,
        co2_reduced_kg: 0,
      });
      expect(profileCacheRef.setCachedCustomerStats).toHaveBeenCalled();
    });

    it('handles empty orders list gracefully', async () => {
      mockEq.mockResolvedValueOnce({ data: null, error: null });

      const result = await getCustomerStats('c1');
      expect(result).toEqual({
        user_id: 'c1',
        total_orders: 0,
        total_saved: 0,
        co2_reduced_kg: 0,
      });
    });

    it('throws when querying orders returns an error', async () => {
      mockEq.mockResolvedValueOnce({ data: null, error: new Error('Orders query failed') });
      await expect(getCustomerStats('c1')).rejects.toThrow('Orders query failed');
    });
  });

  describe('getDriverDetails', () => {
    it('returns cached driver details when available', async () => {
      const cached = { user_id: 'd1', total_trips: 10 };
      profileCacheRef.getCachedDriverDetails.mockResolvedValueOnce(cached);

      const result = await getDriverDetails('d1');
      expect(result).toEqual(cached);
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it('queries driver_details table and sets cache on success', async () => {
      const details = { user_id: 'd1', total_trips: 15, rating: 4.8 };
      mockMaybeSingle.mockResolvedValueOnce({ data: details, error: null });

      const result = await getDriverDetails('d1');
      expect(result).toEqual(details);
      expect(profileCacheRef.setCachedDriverDetails).toHaveBeenCalledWith('d1', details);
    });

    it('throws when driver_details query returns an error', async () => {
      mockMaybeSingle.mockResolvedValueOnce({ data: null, error: new Error('Driver details error') });
      await expect(getDriverDetails('d1')).rejects.toThrow('Driver details error');
    });
  });

  describe('PII Handling (sanitizeProfilePii)', () => {
    it('returns null when given null or undefined input', () => {
      expect(sanitizeProfilePii(null)).toBeNull();
      expect(sanitizeProfilePii(undefined)).toBeNull();
    });

    it('masks phone numbers while preserving the last 4 digits', () => {
      const profile = {
        id: 'u1',
        full_name: 'John Doe',
        phone: '+919876543210',
      };
      const sanitized = sanitizeProfilePii(profile);
      expect(sanitized.phone).toBe('*********3210');
      expect(sanitized.id).toBe('u1');
      expect(sanitized.full_name).toBe('John Doe');
    });

    it('masks short phone numbers with ****', () => {
      const profile = { phone: '123' };
      const sanitized = sanitizeProfilePii(profile);
      expect(sanitized.phone).toBe('****');
    });

    it('masks email addresses preserving first/last characters and domain', () => {
      const profile = {
        email: 'john.doe@example.com',
      };
      const sanitized = sanitizeProfilePii(profile);
      expect(sanitized.email).toBe('j******e@example.com');
    });

    it('masks short email usernames', () => {
      const profile = { email: 'ab@example.com' };
      const sanitized = sanitizeProfilePii(profile);
      expect(sanitized.email).toBe('**@example.com');
    });

    it('masks KYC document number', () => {
      const profile = {
        id: 'u1',
        kyc_doc_number: 'ABCD1234XYZ',
      };
      const sanitized = sanitizeProfilePii(profile);
      expect(sanitized.kyc_doc_number).toBe('********');
    });

    it('does not mutate non-PII fields', () => {
      const profile = {
        id: 'u-99',
        role: 'driver',
        full_name: 'Driver Bob',
        language: 'en',
        dark_mode: true,
      };
      const sanitized = sanitizeProfilePii(profile);
      expect(sanitized).toEqual(profile);
    });
  });

  describe('ProfileService object', () => {
    it('exposes all CRUD and utility methods', () => {
      expect(typeof ProfileService.getProfile).toBe('function');
      expect(typeof ProfileService.getProfileById).toBe('function');
      expect(typeof ProfileService.createProfile).toBe('function');
      expect(typeof ProfileService.updateProfile).toBe('function');
      expect(typeof ProfileService.deleteProfile).toBe('function');
      expect(typeof ProfileService.getCustomerStats).toBe('function');
      expect(typeof ProfileService.getDriverDetails).toBe('function');
      expect(typeof ProfileService.sanitizeProfilePii).toBe('function');
    });
  });
});
