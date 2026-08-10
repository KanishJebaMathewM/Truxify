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
