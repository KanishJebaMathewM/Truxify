import { describe, it, expect, beforeEach } from 'vitest';
import { checkRateLimit, checkSlidingWindowRateLimit } from '../../src/utils/redisSlidingWindow.js';

describe('Redis Sliding Window Rate Limiter Unit Tests', () => {
  const testKey = 'test:rate:limit:ip1';

  beforeEach(() => {
    // Unique key per test run to prevent cross-test leakage
  });

  it('should allow request when within rate limit threshold', async () => {
    const key = `${testKey}:${Math.random()}`;
    const result = await checkSlidingWindowRateLimit(key, { windowMs: 10000, maxRequests: 5 });

    expect(result.allowed).toBe(true);
    expect(result.count).toBe(1);
    expect(result.remaining).toBe(4);
    expect(result.retryAfterMs).toBe(0);
  });

  it('should enforce limit when requests exceed maxRequests in window', async () => {
    const key = `${testKey}:${Math.random()}`;
    const options = { windowMs: 10000, maxRequests: 2 };

    const res1 = await checkSlidingWindowRateLimit(key, options);
    const res2 = await checkSlidingWindowRateLimit(key, options);
    const res3 = await checkSlidingWindowRateLimit(key, options);

    expect(res1.allowed).toBe(true);
    expect(res2.allowed).toBe(true);
    expect(res3.allowed).toBe(false);
    expect(res3.remaining).toBe(0);
    expect(res3.retryAfterMs).toBeGreaterThan(0);
  });

  it('should support legacy checkRateLimit boolean helper', async () => {
    const key = `${testKey}:${Math.random()}`;
    const allowed = await checkRateLimit(key, 10000, 3);
    expect(allowed).toBe(true);
  });
});
