import { describe, it, expect, vi } from 'vitest';
import { redisRateLimiter, checkSlidingWindow } from '../../src/middleware/redisRateLimiter.js';

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


// === Spec 1 test: null pipeline guard ===
describe('redisRateLimiter null-pipeline guard', () => {
  let mockReq;
  let mockRes;
  let mockNext;
  let mockPipeline;
  let mockRedisClient;

  beforeEach(() => {
    mockNext = vi.fn();
    mockPipeline = {
      zremrangebyscore: vi.fn().mockReturnThis(),
      zcard: vi.fn().mockReturnThis(),
      exec: vi.fn(),
    };
    mockRedisClient = { pipeline: vi.fn(() => mockPipeline) };
    mockReq = { ip: '127.0.0.1' };
    mockRes = {
      status: vi.fn(() => mockRes),
      json: vi.fn(),
    };
  });

  it('allows request when pipeline.exec() returns null (connection closed)', async () => {
    mockPipeline.exec.mockResolvedValue(null);
    const middleware = redisRateLimiter({ routeKey: 'test', limit: 10, windowMs: 60000 });
    middleware.client = mockRedisClient;
    await middleware(mockReq, mockRes, mockNext);
    expect(mockNext).toHaveBeenCalled();
  });

  it('allows request when pipeline.exec() results have null second element', async () => {
    mockPipeline.exec.mockResolvedValue([null, null]);
    const middleware = redisRateLimiter({ routeKey: 'test', limit: 10, windowMs: 60000 });
    middleware.client = mockRedisClient;
    await middleware(mockReq, mockRes, mockNext);
    expect(mockNext).toHaveBeenCalled();
  });
});
