import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSocketRateLimiter } from '../../src/lib/socketRateLimiter.js';

describe('socket budget elapsed time', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(['backward', 'frozen'])(
    'refills at the normal cadence when the wall clock is %s', mode => {
      let elapsed = 1000;
      let wallTime = 1000000;
      vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
      vi.spyOn(Date, 'now').mockImplementation(() => wallTime);
      const limiter = createSocketRateLimiter({ capacity: 1, refillPerSecond: 5, maxOverRate: 0 });
      expect(limiter.tryConsume()).toBe(true);
      expect(limiter.tryConsume()).toBe(false);
      expect(limiter.isAbusive()).toBe(true);

      if (mode === 'backward') wallTime -= 60000;
      elapsed += 200;
      expect(limiter.tryConsume()).toBe(true);
      expect(limiter.getOverRateCount()).toBe(0);
      expect(limiter.isAbusive()).toBe(false);
      expect(limiter.tryConsume()).toBe(false);
    },
  );

  it('does not refill early when the wall clock jumps forward', () => {
    let elapsed = 1000;
    let wallTime = 1000000;
    vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
    vi.spyOn(Date, 'now').mockImplementation(() => wallTime);
    const limiter = createSocketRateLimiter({ capacity: 1, refillPerSecond: 5 });
    expect(limiter.tryConsume()).toBe(true);

    wallTime += 60000;
    elapsed += 100;
    expect(limiter.tryConsume()).toBe(false);
    elapsed += 100;
    expect(limiter.tryConsume()).toBe(true);
    expect(limiter.tryConsume()).toBe(false);
  });
});
