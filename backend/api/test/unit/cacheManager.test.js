import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/cache/CachePublisher.js', () => ({
  initCachePublisher: vi.fn(),
  publishInvalidation: vi.fn().mockResolvedValue(undefined),
  subscribeToInvalidation: vi.fn().mockReturnValue(vi.fn()),
  closeCachePublisher: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/cache/CacheInvalidator.js', () => ({
  initCacheInvalidator: vi.fn(),
  invalidateKey: vi.fn().mockResolvedValue(undefined),
  bumpVersion: vi.fn().mockResolvedValue(undefined),
  getStats: vi.fn().mockReturnValue({
    invalidations: 0,
    publishes: 0,
    remoteEventsHandled: 0,
    errors: 0,
    patternScans: 0,
  }),
}));

describe('CacheManager', () => {
  let CacheManager;
  let CacheNamespace;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    CacheNamespace = (await import('../../src/cache/CacheNamespace.js')).CacheNamespace;
    CacheManager = await import('../../src/cache/CacheManager.js');
  });

  describe('init', () => {
    it('initializes with a Redis client', () => {
      const mockClient = { get: vi.fn(), set: vi.fn() };
      CacheManager.init(mockClient);
      expect(CacheManager.isInitialized()).toBe(true);
    });

    it('is idempotent - calling twice does not reinitialize', () => {
      const mockClient = { get: vi.fn(), set: vi.fn() };
      CacheManager.init(mockClient);
      CacheManager.init(mockClient);
      expect(CacheManager.isInitialized()).toBe(true);
    });

    it('logs warning when no Redis client provided', async () => {
      const logger = (await import('../../src/middleware/logger.js')).default;
      CacheManager.init(null);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No Redis client')
      );
      expect(CacheManager.isInitialized()).toBe(false);
    });
  });

  describe('get', () => {
    it('returns null when not initialized', async () => {
      const result = await CacheManager.get('profile', 'user-123');
      expect(result).toBeNull();
    });

    it('returns parsed JSON on cache hit', async () => {
      const mockData = { id: 'user-123', name: 'Test' };
      const mockClient = {
        get: vi.fn().mockResolvedValue(JSON.stringify(mockData)),
      };
      CacheManager.init(mockClient);

      const result = await CacheManager.get('profile', 'user-123');
      expect(result).toEqual(mockData);
      expect(mockClient.get).toHaveBeenCalledWith('user:profile:user-123');
    });

    it('returns null on cache miss', async () => {
      const mockClient = { get: vi.fn().mockResolvedValue(null) };
      CacheManager.init(mockClient);

      const result = await CacheManager.get('profile', 'user-123');
      expect(result).toBeNull();
    });

    it('returns null on Redis error', async () => {
      const mockClient = {
        get: vi.fn().mockRejectedValue(new Error('Redis down')),
      };
      CacheManager.init(mockClient);

      const result = await CacheManager.get('profile', 'user-123');
      expect(result).toBeNull();
    });

    it('builds key with subKey', async () => {
      const mockClient = {
        get: vi.fn().mockResolvedValue(JSON.stringify({ stats: true })),
      };
      CacheManager.init(mockClient);

      await CacheManager.get('profile', 'user-123', 'stats');
      expect(mockClient.get).toHaveBeenCalledWith('user:profile:user-123:stats');
    });
  });

  describe('set', () => {
    it('returns false when not initialized', async () => {
      const result = await CacheManager.set('profile', 'user-123', { data: 1 });
      expect(result).toBe(false);
    });

    it('returns false when entityId is null', async () => {
      const mockClient = { set: vi.fn() };
      CacheManager.init(mockClient);
      const result = await CacheManager.set('profile', null, { data: 1 });
      expect(result).toBe(false);
    });

    it('returns false when value is null', async () => {
      const mockClient = { set: vi.fn() };
      CacheManager.init(mockClient);
      const result = await CacheManager.set('profile', 'user-123', null);
      expect(result).toBe(false);
    });

    it('returns false when value is undefined', async () => {
      const mockClient = { set: vi.fn() };
      CacheManager.init(mockClient);
      const result = await CacheManager.set('profile', 'user-123', undefined);
      expect(result).toBe(false);
    });

    it('calls Redis SET with correct key, serialized value, and TTL', async () => {
      const mockClient = { set: vi.fn().mockResolvedValue('OK') };
      CacheManager.init(mockClient);
      const data = { name: 'Test' };

      const result = await CacheManager.set('profile', 'user-123', data);
      expect(result).toBe(true);
      expect(mockClient.set).toHaveBeenCalledWith(
        'user:profile:user-123',
        JSON.stringify(data),
        'EX',
        expect.any(Number)
      );
    });

    it('uses namespace default TTL', async () => {
      const mockClient = { set: vi.fn().mockResolvedValue('OK') };
      CacheManager.init(mockClient);
      const profileNs = CacheNamespace.get('profile');

      await CacheManager.set('profile', 'user-123', { data: 1 });
      expect(mockClient.set).toHaveBeenCalledWith(
        'user:profile:user-123',
        expect.any(String),
        'EX',
        profileNs.defaultTtl
      );
    });

    it('respects custom TTL', async () => {
      const mockClient = { set: vi.fn().mockResolvedValue('OK') };
      CacheManager.init(mockClient);

      await CacheManager.set('profile', 'user-123', { data: 1 }, { ttl: 60 });
      expect(mockClient.set).toHaveBeenCalledWith(
        'user:profile:user-123',
        expect.any(String),
        'EX',
        60
      );
    });

    it('handles TTL=0 by not setting expiry', async () => {
      const mockClient = { set: vi.fn().mockResolvedValue('OK') };
      CacheManager.init(mockClient);

      await CacheManager.set('profile', 'user-123', { data: 1 }, { ttl: 0 });
      expect(mockClient.set).toHaveBeenCalledWith(
        'user:profile:user-123',
        expect.any(String)
      );
    });

    it('returns false on Redis error', async () => {
      const mockClient = {
        set: vi.fn().mockRejectedValue(new Error('Redis error')),
      };
      CacheManager.init(mockClient);

      const result = await CacheManager.set('profile', 'user-123', { data: 1 });
      expect(result).toBe(false);
    });
  });

  describe('invalidate', () => {
    it('calls invalidator with correct namespace and key', async () => {
      const { invalidateKey } = await import('../../src/cache/CacheInvalidator.js');
      const mockClient = { del: vi.fn() };
      CacheManager.init(mockClient);

      await CacheManager.invalidate('profile', 'user-123');
      expect(invalidateKey).toHaveBeenCalledWith(
        'profile',
        'user:profile:user-123',
        { localOnly: undefined }
      );
    });

    it('passes localOnly option', async () => {
      const { invalidateKey } = await import('../../src/cache/CacheInvalidator.js');
      const mockClient = { del: vi.fn() };
      CacheManager.init(mockClient);

      await CacheManager.invalidate('profile', 'user-123', { localOnly: true });
      expect(invalidateKey).toHaveBeenCalledWith(
        'profile',
        'user:profile:user-123',
        { localOnly: true }
      );
    });

    it('does nothing when not initialized', async () => {
      const { invalidateKey } = await import('../../src/cache/CacheInvalidator.js');
      await CacheManager.invalidate('profile', 'user-123');
      expect(invalidateKey).not.toHaveBeenCalled();
    });
  });

  describe('bumpVersion', () => {
    it('delegates to invalidator', async () => {
      const { bumpVersion } = await import('../../src/cache/CacheInvalidator.js');
      const mockClient = { incr: vi.fn() };
      CacheManager.init(mockClient);

      await CacheManager.bumpVersion('profile', 'user-123');
      expect(bumpVersion).toHaveBeenCalledWith(
        'profile',
        'user-123',
        undefined,
        { localOnly: undefined }
      );
    });

    it('does nothing when not initialized', async () => {
      const { bumpVersion } = await import('../../src/cache/CacheInvalidator.js');
      await CacheManager.bumpVersion('profile', 'user-123');
      expect(bumpVersion).not.toHaveBeenCalled();
    });
  });

  describe('getStats', () => {
    it('returns combined stats', async () => {
      const mockClient = {
        get: vi.fn()
          .mockResolvedValueOnce(JSON.stringify({ id: 1 }))
          .mockResolvedValueOnce(null),
        set: vi.fn().mockResolvedValue('OK'),
      };
      CacheManager.init(mockClient);

      await CacheManager.get('profile', 'user-1');
      await CacheManager.get('profile', 'user-2');
      await CacheManager.set('profile', 'user-3', { data: 1 });

      const stats = CacheManager.getStats();
      expect(stats.cache.hits).toBe(1);
      expect(stats.cache.misses).toBe(1);
      expect(stats.cache.sets).toBe(1);
      expect(stats.total).toBe(2);
      expect(stats.hitRate).toBe('50.0%');
    });
  });

  describe('resetStats', () => {
    it('clears all counters', async () => {
      const mockClient = {
        get: vi.fn().mockResolvedValue(JSON.stringify({ id: 1 })),
        set: vi.fn().mockResolvedValue('OK'),
      };
      CacheManager.init(mockClient);

      await CacheManager.get('profile', 'user-1');
      await CacheManager.set('profile', 'user-1', { data: 1 });

      CacheManager.resetStats();
      const stats = CacheManager.getStats();
      expect(stats.cache.hits).toBe(0);
      expect(stats.cache.misses).toBe(0);
      expect(stats.cache.sets).toBe(0);
    });
  });

  describe('shutdown', () => {
    it('resets initialization state', async () => {
      const mockClient = { get: vi.fn() };
      CacheManager.init(mockClient);
      expect(CacheManager.isInitialized()).toBe(true);

      CacheManager.shutdown();
      expect(CacheManager.isInitialized()).toBe(false);
    });
  });
});
