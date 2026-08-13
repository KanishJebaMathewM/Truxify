import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config/db.js', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

describe('ProfileModel', () => {
  let ProfileModel;
  let mockSupabase;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mockSupabase = (await import('../../src/config/db.js')).supabase;
    ProfileModel = (await import('../../src/models/ProfileModel.js')).ProfileModel;
  });

  describe('findById', () => {
    it('returns profile when found', async () => {
      const mockProfile = { id: 'uuid-1', full_name: 'John Doe', role: 'driver' };
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockProfile, error: null }),
      });

      const result = await ProfileModel.findById('uuid-1');
      expect(result).toEqual(mockProfile);
    });

    it('returns null when profile not found', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } }),
      });

      const result = await ProfileModel.findById('uuid-nonexistent');
      expect(result).toBeNull();
    });

    it('throws when database query fails', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
      });

      await expect(ProfileModel.findById('uuid-error')).rejects.toThrow();
    });
  });

  describe('findByFirebaseUid', () => {
    it('returns profile when found by firebase uid', async () => {
      const mockProfile = { id: 'uuid-2', firebase_uid: 'firebase-uid-1', role: 'customer' };
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockProfile, error: null }),
      });

      const result = await ProfileModel.findByFirebaseUid('firebase-uid-1');
      expect(result).toEqual(mockProfile);
    });

    it('returns null when firebase uid not found', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } }),
      });

      const result = await ProfileModel.findByFirebaseUid('firebase-nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('updateProfile', () => {
    it('updates profile and returns updated data', async () => {
      const updatedProfile = { id: 'uuid-1', full_name: 'Jane Doe', role: 'driver' };
      mockSupabase.from.mockReturnValue({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: updatedProfile, error: null }),
      });

      const result = await ProfileModel.updateProfile('uuid-1', { full_name: 'Jane Doe' });
      expect(result).toEqual(updatedProfile);
    });

    it('throws when update fails', async () => {
      mockSupabase.from.mockReturnValue({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Update failed' } }),
      });

      await expect(ProfileModel.updateProfile('uuid-1', { full_name: 'Fail' })).rejects.toThrow();
    });
  });
});
