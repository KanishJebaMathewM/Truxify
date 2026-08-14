import { describe, it, expect, vi } from 'vitest';
import { redisRateLimiter } from '../../src/middleware/redisRateLimiter.js';

describe('redisRateLimiter Middleware', () => {
  it('bypasses rate limiting when redisClient is null', async () => {
    const middleware = redisRateLimiter({ routeKey: 'test', limit: 10, windowMs: 60000 });
    const req = { ip: '127.0.0.1' };
    const res = {};
    const next = vi.fn();

    await middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});


// === Spec 2 test ===
import { checkSlidingWindow } from '../../src/middleware/redisRateLimiter.js';
describe('checkSlidingWindow', () => {
  it('allows under limit', async () => {
    const r = { eval: vi.fn().mockResolvedValue([1, 1]) };
    expect((await checkSlidingWindow(r, 'k', 1000, 60000, 5, 'm1')).allowed).toBe(true);
  });
  it('denies over limit', async () => {
    const r = { eval: vi.fn().mockResolvedValue([0, 5]) };
    expect((await checkSlidingWindow(r, 'k', 1000, 60000, 5, 'm1')).allowed).toBe(false);
  });
});

