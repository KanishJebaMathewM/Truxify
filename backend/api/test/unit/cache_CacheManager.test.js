/**
 * Unit tests for backend/api/src/cache/CacheManager.js
 *
 * Coverage of the current module API (the class API was retired):
 *   - init: wires the Redis client (idempotent)
 *   - get: parses cached JSON; null on miss; null on read error
 *   - set: serializes JSON with the namespace default TTL (EX); plain set
 *     when TTL is 0; false for missing entityId or null/undefined value
 *   - getOrSetSingleflight: coalesces concurrent fetches into one fetcher call
 *   - getVersion: defaults to 1 when unset or on read error
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const CacheManager = await import('../../src/cache/CacheManager.js');
const { CacheNamespace } = await import('../../src/cache/CacheNamespace.js');

// A minimal in-memory Redis stand-in capturing every call.
const redis = {
  store: new Map(),
  get: vi.fn(async (key) => redis.store.get(key) ?? null),
  set: vi.fn(async (key, value, ...args) => {
    redis.store.set(key, value);
    redis._setArgs = args;
    return 'OK';
  }),
  incr: vi.fn(async (key) => {
    redis.store.set(key, String((Number(redis.store.get(key) || 0)) + 1));
    return Number(redis.store.get(key));
  }),
  del: vi.fn(async (key) => redis.store.delete(key) ? 1 : 0),
  pipeline: vi.fn(() => {
    const ops = [];
    return {
      del: (key) => ops.push(key),
      exec: async () => { for (const k of ops) redis.store.delete(k); return []; },
    };
  }),
};

const NS = 'cachemanager_test';

beforeAll(async () => {
  // init wires the client into both CacheManager and CacheKeyBuilder.
  CacheNamespace.register(NS, { enablePubSub: false });
  // init is idempotent per process; only the first init matters in CI.
  CacheManager.init(redis);
});

beforeEach(() => {
  redis.store.clear();
  vi.clearAllMocks();
});

describe('CacheManager (module contract)', () => {
  describe('set / get', () => {
    it('stores JSON with the namespace default TTL and reads it back', async () => {
      const ok = await CacheManager.set(NS, 'order-1', { total: 5 });
      expect(ok).toBe(true);
      expect(redis.set).toHaveBeenCalledWith(
        expect.stringContaining('order-1'),
        JSON.stringify({ total: 5 }),
        'EX',
        900,
      );

      const value = await CacheManager.get(NS, 'order-1');
      expect(value).toEqual({ total: 5 });
    });

    it('returns null on a cache miss', async () => {
      expect(await CacheManager.get(NS, 'missing')).toBeNull();
    });

    it('returns null and logs on a read error', async () => {
      redis.get.mockRejectedValueOnce(new Error('connection lost'));
      expect(await CacheManager.get(NS, 'order-1')).toBeNull();
    });

    it('writes without EX when the TTL is 0', async () => {
      await CacheManager.set(NS, 'persist', 1, { ttl: 0 });
      expect(redis.set).toHaveBeenCalledWith(
        expect.stringContaining('persist'),
        '1',
      );
    });

    it('refuses to store missing entity ids or null/undefined values', async () => {
      expect(await CacheManager.set(NS, '', { a: 1 })).toBe(false);
      expect(await CacheManager.set(NS, 'order-2', null)).toBe(false);
      expect(await CacheManager.set(NS, 'order-2', undefined)).toBe(false);
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('returns false and logs on a write error', async () => {
      redis.set.mockRejectedValueOnce(new Error('write failed'));
      expect(await CacheManager.set(NS, 'order-3', { a: 1 })).toBe(false);
    });
  });

  describe('getOrSetSingleflight', () => {
    it('coalesces concurrent misses into one fetcher call', async () => {
      let calls = 0;
      const fetcher = async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 5));
        return { fetched: true };
      };

      const [a, b] = await Promise.all([
        CacheManager.getOrSetSingleflight(NS, 'shared', fetcher),
        CacheManager.getOrSetSingleflight(NS, 'shared', fetcher),
      ]);

      expect(a).toEqual({ fetched: true });
      expect(b).toEqual({ fetched: true });
      expect(calls).toBe(1);
    });

    it('serves the cached value on the second call', async () => {
      let calls = 0;
      const fetcher = async () => { calls++; return 'computed'; };

      await CacheManager.getOrSetSingleflight(NS, 'cached-key', fetcher);
      const second = await CacheManager.getOrSetSingleflight(NS, 'cached-key', fetcher);

      expect(second).toBe('computed');
      expect(calls).toBe(1);
    });
  });

  describe('getVersion', () => {
    it('defaults to 1 when no version is stored', async () => {
      expect(await CacheManager.getVersion(NS, 'order-1')).toBe(1);
    });

    it('returns the stored version', async () => {
      const { CacheKeyBuilder } = await import('../../src/cache/CacheKeyBuilder.js');
      const key = CacheKeyBuilder.versionKey(NS, 'order-9');
      redis.store.set(key, '4');
      expect(await CacheManager.getVersion(NS, 'order-9')).toBe(4);
    });

    it('returns 1 on a read error', async () => {
      redis.get.mockRejectedValueOnce(new Error('connection lost'));
      expect(await CacheManager.getVersion(NS, 'order-x')).toBe(1);
    });
  });
});
