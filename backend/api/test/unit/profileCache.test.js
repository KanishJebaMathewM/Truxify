import { describe, it, expect, beforeEach } from 'vitest';
import {
  getCacheStats,
  resetCacheStats,
} from '../../lib/profileCache.js';

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
  });
});


// === Spec 8 test ===
import { describe, it, expect } from 'vitest';
import { isValidProfile } from '../../src/lib/profileCache.js';
describe('isValidProfile', () => {
  it('accepts valid', () => {
    expect(isValidProfile({ id: 'a', createdAt: '2026-01-01T00:00:00Z' })).toBe(true);
  });
  it('rejects null', () => { expect(isValidProfile(null)).toBe(false); });
  it('rejects missing id', () => { expect(isValidProfile({ createdAt: '2026-01-01T00:00:00Z' })).toBe(false); });
  it('rejects bad date', () => { expect(isValidProfile({ id: 'a', createdAt: 'bad' })).toBe(false); });
});

