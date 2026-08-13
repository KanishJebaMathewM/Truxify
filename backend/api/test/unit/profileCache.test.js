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
  });
});


// === Spec 8 test ===
import { describe, it, expect } from 'vitest';
import { isValidProfile } from '../../src/lib/profileCache.js';
describe('isValidProfile', () => {
  it('accepts valid profile with required fields', () => {
    expect(isValidProfile({ id: 'a', createdAt: '2026-01-01T00:00:00Z' })).toBe(true);
  });

  it('accepts profile with additional optional fields', () => {
    expect(isValidProfile({ id: 'user-123', createdAt: '2026-08-13T12:00:00Z', email: 'test@example.com' })).toBe(true);
  });

  it('rejects null', () => {
    expect(isValidProfile(null)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isValidProfile(undefined)).toBe(false);
  });

  it('rejects non-object types', () => {
    expect(isValidProfile('string')).toBe(false);
    expect(isValidProfile(123)).toBe(false);
    expect(isValidProfile(true)).toBe(false);
    expect(isValidProfile(() => {})).toBe(false);
  });

  it('rejects arrays', () => {
    expect(isValidProfile([])).toBe(false);
    expect(isValidProfile(['id', 'createdAt'])).toBe(false);
  });

  it('rejects when id is missing', () => {
    expect(isValidProfile({ createdAt: '2026-01-01T00:00:00Z' })).toBe(false);
  });

  it('rejects when id is not a non-empty string', () => {
    expect(isValidProfile({ id: '', createdAt: '2026-01-01T00:00:00Z' })).toBe(false);
    expect(isValidProfile({ id: 123, createdAt: '2026-01-01T00:00:00Z' })).toBe(false);
    expect(isValidProfile({ id: null, createdAt: '2026-01-01T00:00:00Z' })).toBe(false);
  });

  it('rejects when createdAt is missing', () => {
    expect(isValidProfile({ id: 'user-123' })).toBe(false);
  });

  it('rejects when createdAt is not a valid ISO date string', () => {
    expect(isValidProfile({ id: 'user-123', createdAt: 'bad' })).toBe(false);
    expect(isValidProfile({ id: 'user-123', createdAt: '' })).toBe(false);
    expect(isValidProfile({ id: 'user-123', createdAt: '2026-13-01T00:00:00Z' })).toBe(false);  // invalid month
    expect(isValidProfile({ id: 'user-123', createdAt: null })).toBe(false);
    expect(isValidProfile({ id: 'user-123', createdAt: undefined })).toBe(false);
  });

  it('accepts various valid ISO date strings', () => {
    expect(isValidProfile({ id: 'u1', createdAt: '2026-01-01T00:00:00Z' })).toBe(true);
    expect(isValidProfile({ id: 'u1', createdAt: '2026-08-13T23:59:59.999Z' })).toBe(true);
  });
});

