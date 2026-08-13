import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

describe('redisRateLimiter pipeline result handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeClient(execResult) {
    const client = {
      pipeline: vi.fn(() => ({
        zremrangebyscore: vi.fn(),
        zcard: vi.fn(),
        exec: vi.fn().mockResolvedValue(execResult),
        zadd: vi.fn(),
        pexpire: vi.fn(),
      })),
      zrange: vi.fn(),
    };
    return client;
  }

  async function loadMiddleware(client) {
    vi.resetModules();
    vi.doMock('../../src/config/db.js', () => ({
      redisClient: client,
      supabase: null,
      supabaseAdmin: null,
      pgPool: null,
      mongoDb: null,
      firebaseAdmin: null,
    }));
    const { redisRateLimiter } = await import('../../src/middleware/redisRateLimiter.js');
    return redisRateLimiter;
  }

  it('fails open when pipeline.exec resolves to a null result', async () => {
    const client = makeClient(null);
    const redisRateLimiter = await loadMiddleware(client);
    const middleware = redisRateLimiter({ routeKey: 'test', limit: 10, windowMs: 60000, failClosed: false });
    const req = { ip: '127.0.0.1' };
    const res = { set: vi.fn(), status: vi.fn(() => ({ json: vi.fn() })) };
    const next = vi.fn();
    await middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it('fails closed with 503 when pipeline.exec resolves to a short array', async () => {
    const client = makeClient([]);
    const redisRateLimiter = await loadMiddleware(client);
    const middleware = redisRateLimiter({ routeKey: 'test', limit: 10, windowMs: 60000, failClosed: true });
    const req = { ip: '127.0.0.1' };
    const json = vi.fn();
    const res = { set: vi.fn(), status: vi.fn(() => ({ json })) };
    const next = vi.fn();
    await middleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
  });

  it('fails open with 429 when the count exceeds the limit', async () => {
    const client = makeClient([[null, 1], [null, 10]]);
    client.zrange.mockResolvedValue(['100', '2000']);
    const redisRateLimiter = await loadMiddleware(client);
    const middleware = redisRateLimiter({ routeKey: 'test', limit: 10, windowMs: 60000, failClosed: false });
    const req = { ip: '127.0.0.1' };
    const json = vi.fn();
    const res = { set: vi.fn(), status: vi.fn(() => ({ json })) };
    const next = vi.fn();
    await middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(next).not.toHaveBeenCalled();
  });
});
