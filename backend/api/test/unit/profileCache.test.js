import { describe, it, expect, beforeEach } from 'vitest';
import {
  getCacheStats,
  resetCacheStats,
} from '../../src/lib/profileCache.js';

describe('profileCache stats', () => {
  beforeEach(() => {
    resetCacheStats();
  });

  it('returns zero stats on fresh reset', () => {
    const stats = getCacheStats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
    expect(stats.sets).toBe(0);
    expect(stats.total).toBe(0);
    expect(stats.hitRate).toBe('0%');
  });

  it('hit rate is 0% when no requests made', () => {
    const stats = getCacheStats();
    expect(stats.hitRate).toBe('0%');
  });

  describe('isValidCachedSupabaseProfile', () => {
    it('returns false when userId is not a non-empty string', async () => {
      const { isValidCachedSupabaseProfile } = await import('../../src/lib/profileCache.js');
      const validProfile = { id: 'user-123', role: 'driver', isActive: true };
      expect(isValidCachedSupabaseProfile(null, validProfile)).toBe(false);
      expect(isValidCachedSupabaseProfile('', validProfile)).toBe(false);
      expect(isValidCachedSupabaseProfile(123, validProfile)).toBe(false);
      expect(isValidCachedSupabaseProfile('   ', validProfile)).toBe(false);
    });

    it('validates active and inactive Supabase profiles correctly', async () => {
      const { isValidCachedSupabaseProfile } = await import('../../src/lib/profileCache.js');
      const activeProfile = { id: 'user-123', role: 'driver', isActive: true, fullName: 'John Doe' };
      const tombstoneProfile = { id: 'user-123', isActive: false };
      const mismatchProfile = { id: 'user-999', role: 'driver', isActive: true };

      expect(isValidCachedSupabaseProfile('user-123', activeProfile)).toBe(true);
      expect(isValidCachedSupabaseProfile('user-123', tombstoneProfile)).toBe(true);
      expect(isValidCachedSupabaseProfile('user-123', mismatchProfile)).toBe(false);
    });
  });

  describe('isValidCachedProfile', () => {
    it('validates Firebase profile UIDs and shapes', async () => {
      const { isValidCachedProfile } = await import('../../src/lib/profileCache.js');
      const validProfile = { uid: 'fb-123', id: 'profile-1', role: 'customer', isActive: true };
      const tombstone = { isActive: false };

      expect(isValidCachedProfile('fb-123', validProfile)).toBe(true);
      expect(isValidCachedProfile('fb-123', tombstone)).toBe(true);
      expect(isValidCachedProfile('fb-999', validProfile)).toBe(false);
      expect(isValidCachedProfile(null, validProfile)).toBe(false);
    });
  });
});
