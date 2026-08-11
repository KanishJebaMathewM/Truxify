import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('profileCacheKeys - CacheKeyBuilder integration', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('exports all original key generation functions', async () => {
    const mod = await import('../../src/cache/profileCacheKeys.js');
    expect(typeof mod.firebaseProfileKey).toBe('function');
    expect(typeof mod.supabaseProfileKey).toBe('function');
    expect(typeof mod.customerStatsKey).toBe('function');
    expect(typeof mod.driverDetailsKey).toBe('function');
  });

  it('exports PROFILE_KEY_PREFIX', async () => {
    const mod = await import('../../src/cache/profileCacheKeys.js');
    expect(mod.PROFILE_KEY_PREFIX).toBe('user:profile');
  });

  it('firebaseProfileKey produces backward-compatible key', async () => {
    const mod = await import('../../src/cache/profileCacheKeys.js');
    expect(mod.firebaseProfileKey('abc123')).toBe('user:profile:abc123');
  });

  it('supabaseProfileKey produces backward-compatible key', async () => {
    const mod = await import('../../src/cache/profileCacheKeys.js');
    expect(mod.supabaseProfileKey('user-456')).toBe('user:profile:sb:user-456');
  });

  it('customerStatsKey produces backward-compatible key', async () => {
    const mod = await import('../../src/cache/profileCacheKeys.js');
    expect(mod.customerStatsKey('user-456')).toBe('user:profile:sb:user-456:stats');
  });

  it('driverDetailsKey produces backward-compatible key', async () => {
    const mod = await import('../../src/cache/profileCacheKeys.js');
    expect(mod.driverDetailsKey('user-456')).toBe('user:profile:sb:user-456:driver');
  });

  it('exports PROFILE_SUB_KEYS constants', async () => {
    const mod = await import('../../src/cache/profileCacheKeys.js');
    expect(mod.PROFILE_SUB_KEYS).toEqual({ STATS: 'stats', DRIVER: 'driver' });
  });

  it('profileCacheKey produces backward-compatible key', async () => {
    const mod = await import('../../src/cache/profileCacheKeys.js');
    const key = mod.profileCacheKey('user-789');
    expect(key).toBe('user:profile:sb:user-789');
  });

  it('profileCacheKey with subKey produces correct key', async () => {
    const mod = await import('../../src/cache/profileCacheKeys.js');
    const key = mod.profileCacheKey('user-789', 'stats');
    expect(key).toBe('user:profile:sb:user-789:stats');
  });

  it('profileCacheKey matches the legacy Supabase profile key (writer == invalidator)', async () => {
    const mod = await import('../../src/cache/profileCacheKeys.js');
    expect(mod.profileCacheKey('user-789')).toBe(mod.supabaseProfileKey('user-789'));
  });

  it('profileCacheKey with subKey matches the legacy sub-key helpers', async () => {
    const mod = await import('../../src/cache/profileCacheKeys.js');
    expect(mod.profileCacheKey('user-789', 'stats')).toBe(mod.customerStatsKey('user-789'));
    expect(mod.profileCacheKey('user-789', 'driver')).toBe(mod.driverDetailsKey('user-789'));
  });
});
