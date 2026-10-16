import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// The middleware-level behavior (thresholds, bans, Retry-After) is covered by
// authFailureMonitor.test.js — this file adds the Redis-backed pre-check.
const { checkBoundOrFailClosed } = await import('../../src/middleware/authFailureMonitor.js');

describe('checkBoundOrFailClosed (Redis-backed auth-failure pre-check)', () => {
  it('allows under the attempt cap', async () => {
    const res = await checkBoundOrFailClosed({ incr: async () => 1 }, '1.2.3.4', { maxAttempts: 5 });
    expect(res.allowed).toBe(true);
    expect(res.count).toBe(1);
  });

  it('blocks at the cap', async () => {
    const res = await checkBoundOrFailClosed({ incr: async () => 5 }, '1.2.3.4', { maxAttempts: 5 });
    expect(res).toEqual({ allowed: false, reason: 'banned' });
  });

  it('fails CLOSED on Redis timeout (security_unavailable)', async () => {
    const redis = { incr: () => new Promise(() => {}) };
    const res = await checkBoundOrFailClosed(redis, '1.2.3.4', { maxAttempts: 5, redisTimeoutMs: 50 });
    expect(res).toEqual({ allowed: false, reason: 'security_unavailable' });
  });

  it('propagates real Redis errors (not timeouts)', async () => {
    const redis = { incr: async () => { throw new Error('ECONNRESET'); } };
    await expect(checkBoundOrFailClosed(redis, '1.2.3.4')).rejects.toThrow('ECONNRESET');
  });
});
