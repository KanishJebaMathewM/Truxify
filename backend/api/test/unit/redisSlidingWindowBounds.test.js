import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_RATE_LIMIT_KEY_LENGTH,
  MAX_TRACKED_RATE_LIMIT_KEYS,
  checkSlidingWindowRateLimit,
  getSlidingWindowFallbackSize,
  pruneSlidingWindowFallback,
} from '../../src/utils/redisSlidingWindow.js';

function resetFallback() {
  pruneSlidingWindowFallback(Number.MAX_SAFE_INTEGER);
  pruneSlidingWindowFallback(0);
}

describe('sliding-window fallback bounds', () => {
  beforeEach(resetFallback);
  afterEach(() => {
    vi.useRealTimers();
    resetFallback();
  });

  it('rejects unsafe window and request limits', async () => {
    await expect(checkSlidingWindowRateLimit('k', { windowMs: 0 })).rejects.toThrow(RangeError);
    await expect(checkSlidingWindowRateLimit('k', { windowMs: -1 })).rejects.toThrow(RangeError);
    await expect(checkSlidingWindowRateLimit('k', { windowMs: 1.5 })).rejects.toThrow(RangeError);
    await expect(checkSlidingWindowRateLimit('k', { windowMs: '60000' })).rejects.toThrow(RangeError);
    await expect(checkSlidingWindowRateLimit('k', { maxRequests: 0 })).rejects.toThrow(RangeError);
    await expect(checkSlidingWindowRateLimit('k', { maxRequests: -5 })).rejects.toThrow(RangeError);
    await expect(checkSlidingWindowRateLimit('k', { maxRequests: 1000001 })).rejects.toThrow(RangeError);
  });

  it('fails closed for missing, non-string, or oversized keys', async () => {
    for (const key of ['', null, 42, 'x'.repeat(MAX_RATE_LIMIT_KEY_LENGTH + 1)]) {
      const result = await checkSlidingWindowRateLimit(key, { windowMs: 1000, maxRequests: 10 });
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfterMs).toBe(1000);
    }
  });

  it('still enforces the limit for a valid key', async () => {
    const options = { windowMs: 1000, maxRequests: 2 };
    await expect(checkSlidingWindowRateLimit('valid-key', options)).resolves.toMatchObject({ allowed: true, count: 1 });
    await expect(checkSlidingWindowRateLimit('valid-key', options)).resolves.toMatchObject({ allowed: true, count: 2 });
    await expect(checkSlidingWindowRateLimit('valid-key', options)).resolves.toMatchObject({ allowed: false, count: 2 });
  });

  it('sweeps expired keys across the whole fallback store', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    resetFallback();

    await checkSlidingWindowRateLimit('stale-key', { windowMs: 1000, maxRequests: 1 });
    expect(getSlidingWindowFallbackSize()).toBe(1);

    vi.setSystemTime(new Date('2026-01-01T00:01:01.000Z'));
    await checkSlidingWindowRateLimit('fresh-key', { windowMs: 1000, maxRequests: 1 });

    expect(getSlidingWindowFallbackSize()).toBe(1);
  });

  it('caps tracked keys and evicts the least recently used key', async () => {
    const options = { windowMs: 60000, maxRequests: 1 };

    for (let index = 0; index < MAX_TRACKED_RATE_LIMIT_KEYS; index += 1) {
      await checkSlidingWindowRateLimit(`cap:${index}`, options);
    }
    expect(getSlidingWindowFallbackSize()).toBe(MAX_TRACKED_RATE_LIMIT_KEYS);

    await checkSlidingWindowRateLimit('cap:overflow', options);
    expect(getSlidingWindowFallbackSize()).toBe(MAX_TRACKED_RATE_LIMIT_KEYS);
    expect(await checkSlidingWindowRateLimit('cap:0', options)).toMatchObject({ allowed: true, count: 1 });
  });

  it('prunes a key after its own window even when no other key arrives', async () => {
    const now = Date.now();
    pruneSlidingWindowFallback(now);
    await checkSlidingWindowRateLimit('self-expiring', { windowMs: 1000, maxRequests: 1 });

    expect(pruneSlidingWindowFallback(now + 61000)).toBe(1);
    expect(getSlidingWindowFallbackSize()).toBe(0);
  });
});
