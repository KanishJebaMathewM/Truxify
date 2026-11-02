import { describe, it, expect, vi, beforeEach } from 'vitest';

// The session-id/ALS middleware this suite targeted was renamed away
// (0ef1600a60) — the file now exports requestCache (redis response cache).
// Rewritten against the real export.

const redis = vi.hoisted(() => ({
  get: vi.fn(),
  setEx: vi.fn().mockResolvedValue('OK'),
}));

vi.mock('../../src/config/db.js', () => ({
  redisClient: redis,
  supabase: null,
  supabaseAdmin: null,
  firebaseAdmin: null,
  mongoDb: null,
}));
vi.mock('../../src/middleware/logger.js', () => ({
  default: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const { requestCache, requestCacheMiddleware } = await import('../../src/middleware/requestCacheMiddleware.js');

const mockRes = () => {
  const res = {
    statusCode: 200,
    json: vi.fn(function (b) { return res; }),
    status: vi.fn(function (c) { res.statusCode = c; return res; }),
  };
  return res;
};

describe('requestCache middleware', () => {
  beforeEach(() => vi.clearAllMocks());

  it('skips caching for non-GET requests', async () => {
    const mw = requestCache(60);
    const next = vi.fn();
    await mw({ method: 'POST', originalUrl: '/x' }, mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('serves a cached GET response without calling next', async () => {
    redis.get.mockResolvedValue(JSON.stringify({ status: 200, body: { cached: true } }));
    const res = mockRes();
    const next = vi.fn();
    await requestCache(60)({ method: 'GET', originalUrl: '/api/orders', user: { id: 'user-1' } }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ cached: true });
  });

  it('caches a successful GET response via res.json interception', async () => {
    redis.get.mockResolvedValue(null);
    const res = mockRes();
    const next = vi.fn(() => res.json({ fresh: true }));
    await requestCache(60)({ method: 'GET', originalUrl: '/api/orders', user: { id: 'user-1' } }, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(redis.setEx).toHaveBeenCalledWith('cache:user:user-1:/api/orders', 60, expect.stringContaining('"fresh":true'));
  });

  it('does not cache error responses', async () => {
    redis.get.mockResolvedValue(null);
    const res = mockRes();
    res.statusCode = 500;
    await requestCache(60)({ method: 'GET', originalUrl: '/api/orders', user: { id: 'user-1' } }, res, vi.fn(() => res.json({ error: 'x' })));
    expect(redis.setEx).not.toHaveBeenCalled();
  });

  it('falls through when redis read throws', async () => {
    redis.get.mockRejectedValue(new Error('redis down'));
    const next = vi.fn();
    await requestCache(60)({ method: 'GET', originalUrl: '/x', user: { id: 'user-1' } }, mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('exports the middleware name imported by the API entry point', () => {
    expect(requestCacheMiddleware).toBe(requestCache);
  });

  it('does not reuse a cache entry across authenticated users', async () => {
    redis.get.mockResolvedValue(null);
    const firstRes = mockRes();
    const secondRes = mockRes();
    const firstNext = vi.fn(() => firstRes.json({ owner: 'user-1' }));
    const secondNext = vi.fn(() => secondRes.json({ owner: 'user-2' }));

    await requestCache(60)(
      { method: 'GET', originalUrl: '/api/orders', user: { id: 'user-1' } },
      firstRes,
      firstNext
    );
    await requestCache(60)(
      { method: 'GET', originalUrl: '/api/orders', user: { id: 'user-2' } },
      secondRes,
      secondNext
    );

    expect(redis.get).toHaveBeenNthCalledWith(1, 'cache:user:user-1:/api/orders');
    expect(redis.get).toHaveBeenNthCalledWith(2, 'cache:user:user-2:/api/orders');
  });

  it('bypasses the cache when no authenticated user is present', async () => {
    const next = vi.fn();
    await requestCache(60)({ method: 'GET', originalUrl: '/api/orders' }, mockRes(), next);

    expect(next).toHaveBeenCalledOnce();
    expect(redis.get).not.toHaveBeenCalled();
  });
});
