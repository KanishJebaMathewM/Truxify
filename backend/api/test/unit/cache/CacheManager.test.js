import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

vi.mock('../../../src/cache/CachePublisher.js', () => ({
  initCachePublisher: vi.fn(),
  publishInvalidation: vi.fn(),
  subscribeToInvalidation: vi.fn(),
}));

vi.mock('../../../src/cache/CacheInvalidator.js', () => ({
  initCacheInvalidator: vi.fn(),
  invalidateKey: vi.fn(),
  bumpVersion: vi.fn(),
  getStats: vi.fn().mockReturnValue({}),
  invalidateNamespace: vi.fn(),
}));

const cacheManager = await import('../../../src/cache/CacheManager.js');
const { CacheNamespace } = await import('../../../src/cache/CacheNamespace.js');

function mockRedisClient() {
  return {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    pipeline: vi.fn(() => ({
      del: vi.fn(),
      exec: vi.fn().mockResolvedValue([]),
    })),
  };
}

describe('CacheManager', () => {
  let client;

  beforeEach(() => {
    vi.clearAllMocks();
    client = mockRedisClient();
    cacheManager.shutdown();
    cacheManager.init(client);
    cacheManager.resetStats();
  });

  afterEach(() => {
    cacheManager.shutdown();
  });

  it('init wires the Redis client and marks initialization', () => {
    expect(cacheManager.isInitialized()).toBe(true);
    expect(cacheManager.getRedisClient()).toBe(client);
  });

  it('get returns parsed JSON on a hit and counts it', async () => {
    client.get.mockResolvedValue(JSON.stringify({ id: 1 }));
    const value = await cacheManager.get('profile', 'u1');
    expect(value).toEqual({ id: 1 });
    expect(client.get).toHaveBeenCalledWith('user:profile:u1');
    expect(cacheManager.getStats().cache.hits).toBe(1);
  });

  it('get returns null on a miss and counts it', async () => {
    client.get.mockResolvedValue(null);
    expect(await cacheManager.get('profile', 'u1')).toBeNull();
    expect(cacheManager.getStats().cache.misses).toBe(1);
  });

  it('get returns null and counts an error when Redis throws', async () => {
    client.get.mockRejectedValue(new Error('redis down'));
    expect(await cacheManager.get('profile', 'u1')).toBeNull();
    expect(cacheManager.getStats().cache.errors).toBe(1);
  });

  it('set stores a JSON value with a TTL', async () => {
    client.set.mockResolvedValue('OK');
    const ok = await cacheManager.set('profile', 'u1', { name: 'a' }, { ttl: 60 });
    expect(ok).toBe(true);
    expect(client.set).toHaveBeenCalledWith(
      'user:profile:u1',
      JSON.stringify({ name: 'a' }),
      'EX',
      60,
    );
  });

  it('set returns false without a redis client', async () => {
    cacheManager.shutdown();
    expect(await cacheManager.set('profile', 'u1', 'v')).toBe(false);
  });

  it('getVersion returns the parsed version', async () => {
    client.get.mockResolvedValue('5');
    expect(await cacheManager.getVersion('profile', 'u1')).toBe(5);
  });

  it('getVersion falls back to 1 on error', async () => {
    client.get.mockRejectedValue(new Error('down'));
    expect(await cacheManager.getVersion('profile', 'u1')).toBe(1);
  });

  it('resetStats zeroes the counters', async () => {
    client.get.mockResolvedValue(JSON.stringify({ a: 1 }));
    await cacheManager.get('profile', 'u1');
    expect(cacheManager.getStats().cache.hits).toBe(1);
    cacheManager.resetStats();
    expect(cacheManager.getStats().cache.hits).toBe(0);
  });

  it('shutdown clears the client and initialization flag', () => {
    cacheManager.shutdown();
    expect(cacheManager.isInitialized()).toBe(false);
    expect(cacheManager.getRedisClient()).toBeNull();
  });

  it('CacheNamespace built-ins include profile with the user:profile prefix', () => {
    const ns = CacheNamespace.get('profile');
    expect(ns.prefix).toBe('user:profile');
  });
});
