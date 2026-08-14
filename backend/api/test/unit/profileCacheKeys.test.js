import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/cache/CacheKeyBuilder.js', () => ({
  CacheKeyBuilder: {
    build: (namespace, id, subKey) => {
      return `cache:${namespace}:${id}${subKey ? ':' + subKey : ''}`;
    },
  },
}));

describe('profileCacheKeys', () => {
  it('firebaseProfileKey generates correct key', async () => {
    const { firebaseProfileKey } = await import('../../src/cache/profileCacheKeys.js');
    expect(firebaseProfileKey('abc123')).toBe('user:profile:abc123');
    expect(firebaseProfileKey('uid-xyz')).toBe('user:profile:uid-xyz');
  });

  it('supabaseProfileKey generates correct key', async () => {
    const { supabaseProfileKey } = await import('../../src/cache/profileCacheKeys.js');
    const key = supabaseProfileKey('550e8400-e29b-41d4-a716-446655440000');
    expect(key).toBe('user:profile:sb:550e8400-e29b-41d4-a716-446655440000');
  });

  it('customerStatsKey generates correct key', async () => {
    const { customerStatsKey } = await import('../../src/cache/profileCacheKeys.js');
    const key = customerStatsKey('550e8400-e29b-41d4-a716-446655440000');
    expect(key).toBe('user:profile:sb:550e8400-e29b-41d4-a716-446655440000:stats');
  });

  it('driverDetailsKey generates correct key', async () => {
    const { driverDetailsKey } = await import('../../src/cache/profileCacheKeys.js');
    const key = driverDetailsKey('550e8400-e29b-41d4-a716-446655440000');
    expect(key).toBe('user:profile:sb:550e8400-e29b-41d4-a716-446655440000:driver');
  });

  it('PROFILE_KEY_PREFIX is exported', async () => {
    const { PROFILE_KEY_PREFIX } = await import('../../src/cache/profileCacheKeys.js');
    expect(PROFILE_KEY_PREFIX).toBe('user:profile');
  });

  it('PROFILE_SUB_KEYS constants are exported', async () => {
    const { PROFILE_SUB_KEYS } = await import('../../src/cache/profileCacheKeys.js');
    expect(PROFILE_SUB_KEYS.STATS).toBe('stats');
    expect(PROFILE_SUB_KEYS.DRIVER).toBe('driver');
  });

  it('profileCacheKey generates correct key via CacheKeyBuilder', async () => {
    const { profileCacheKey } = await import('../../src/cache/profileCacheKeys.js');
    const key = profileCacheKey('uid123');
    expect(key).toBe('cache:profile:sb:uid123');
  });

  it('profileCacheKey with subKey generates correct key', async () => {
    const { profileCacheKey } = await import('../../src/cache/profileCacheKeys.js');
    const key = profileCacheKey('uid123', 'stats');
    expect(key).toBe('cache:profile:sb:uid123:stats');
  });
});
