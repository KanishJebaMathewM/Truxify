import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../src/config/db.js', () => ({ get redisClient() { return null; } }));

const { TokenBucketRateLimiter } = await import('../../src/middleware/mlRateLimiter.js');

const mkReqRes = (userId = null, ip = '203.0.113.9') => ({
  req: { user: userId ? { id: userId } : null, ip, headers: { 'user-agent': 'test-agent' }, connection: { remoteAddress: ip } },
  res: {
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  },
});

describe('TokenBucketRateLimiter (in-memory fallback path)', () => {
  it('consumes up to capacity, then 429s with retryAfter', () => {
    const rl = new TokenBucketRateLimiter({ capacity: 3, refillRate: 0.0001 }); // ~never refills
    const { req, res } = mkReqRes('u1');
    for (let i = 0; i < 3; i++) {
      let nextCalled = false;
      rl.consume(req, res, () => (nextCalled = true));
      expect(nextCalled, `request ${i + 1}`).toBe(true);
    }
    let nextCalled = false;
    rl.consume(req, res, () => (nextCalled = true));
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(429);
    expect(res.body.error).toBe('Too Many Requests');
    expect(res.body.retryAfter).toBeGreaterThan(0);
    rl.destroy?.();
  });

  it('sets X-RateLimit headers on allowed requests', () => {
    const rl = new TokenBucketRateLimiter({ capacity: 10, refillRate: 1 });
    const { req, res } = mkReqRes('u2');
    rl.consume(req, res, () => {});
    expect(res.headers['X-RateLimit-Limit']).toBe(10);
    expect(res.headers['X-RateLimit-Remaining']).toBe(9);
    rl.destroy?.();
  });

  it('per-user buckets are independent', () => {
    const rl = new TokenBucketRateLimiter({ capacity: 1, refillRate: 0.0001 });
    const a = mkReqRes('userA');
    const b = mkReqRes('userB');
    let aNext = false, bNext = false;
    rl.consume(a.req, a.res, () => (aNext = true));
    rl.consume(b.req, b.res, () => (bNext = true));
    expect(aNext && bNext).toBe(true);
    rl.destroy?.();
  });

  it('anonymous clients are bucketed by ip+ua fingerprint', () => {
    const rl = new TokenBucketRateLimiter({ capacity: 1, refillRate: 0.0001 });
    const a = mkReqRes(null, '10.0.0.1');
    const b = mkReqRes(null, '10.0.0.2');
    rl.consume(a.req, a.res, () => {});
    let bNext = false;
    rl.consume(b.req, b.res, () => (bNext = true));
    expect(bNext).toBe(true, 'different IP = different bucket');
    let aSecond = false;
    rl.consume(a.req, a.res, () => (aSecond = true));
    expect(aSecond).toBe(false, 'same ip+ua exhausts its own bucket');
    rl.destroy?.();
  });

  it('tokens refill over time', async () => {
    const rl = new TokenBucketRateLimiter({ capacity: 1, refillRate: 50 }); // 50 tokens/s
    const { req, res } = mkReqRes('u3');
    rl.consume(req, res, () => {});
    await new Promise((r) => setTimeout(r, 30)); // ~1.5 tokens refilled
    let nextCalled = false;
    rl.consume(req, res, () => (nextCalled = true));
    expect(nextCalled).toBe(true);
    rl.destroy?.();
  });

  it('destroy clears the cleanup interval', () => {
    const rl = new TokenBucketRateLimiter({});
    rl.destroy?.();
    expect(rl.cleanupInterval).toBeNull();
  });
});
