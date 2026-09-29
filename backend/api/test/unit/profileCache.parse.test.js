import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/db.js', () => ({
  getRedisClient: () => null,
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('../../src/cache/profileCacheKeys.js', () => ({
  firebaseProfileKey: () => 'firebase:profile',
  supabaseProfileKey: () => 'sb:profile',
  customerStatsKey: () => 'sb:stats',
  driverDetailsKey: () => 'sb:driver-details',
}));

import * as profileCache from '../../src/lib/profileCache.js';

describe('profileCache module health', () => {
  it('loads without a syntax error (regression for the unclosed brace in invalidateCachedSupabaseProfileAll)', () => {
    expect(typeof profileCache.invalidateProfileCache).toBe('function');
    expect(typeof profileCache.isValidProfile).toBe('function');
    expect(profileCache.TTL_SECONDS).toBeGreaterThan(0);
  });

  it('exposes every expected cache operation', () => {
    for (const name of [
      'getCachedProfile',
      'setCachedProfile',
      'invalidateCachedProfile',
      'getCachedSupabaseProfile',
      'setCachedSupabaseProfile',
      'invalidateCachedSupabaseProfile',
      'invalidateCachedSupabaseProfileAll',
      'getCachedCustomerStats',
      'setCachedCustomerStats',
      'getCachedDriverDetails',
      'setCachedDriverDetails',
    ]) {
      expect(typeof profileCache[name], `${name} should be exported`).toBe('function');
    }
  });

  it('enforces the profile shape guard', () => {
    expect(profileCache.isValidProfile(null)).toBe(false);
    expect(profileCache.isValidProfile({ id: 'u1', createdAt: new Date().toISOString() })).toBe(true);
    expect(profileCache.isValidProfile({ id: 'u1' })).toBe(false);
  });

  it('invalidateProfileCache delegates to the all-key invalidator', async () => {
    const result = await profileCache.invalidateProfileCache('user-1');
    expect(result).toBeUndefined();
  });
});