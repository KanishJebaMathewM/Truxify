import { describe, it, expect } from 'vitest';
import { createSocketRateLimiter, SOCKET_RATE_LIMIT_DEFAULTS } from '../../src/lib/socketRateLimiter.js';

/** Deterministic clock so refill behaviour is testable without timers. */
function fakeClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advanceMs(ms) { t += ms; },
  };
}

describe('createSocketRateLimiter', () => {
  it('allows a full burst immediately on a fresh connection', () => {
    const clock = fakeClock();
    const limiter = createSocketRateLimiter({ now: clock.now, capacity: 5, refillPerSecond: 1 });

    for (let i = 0; i < 5; i += 1) {
      expect(limiter.tryConsume()).toBe(true);
    }
    expect(limiter.tryConsume()).toBe(false);
  });

  it('refills proportionally to elapsed time, not per call', () => {
    const clock = fakeClock();
    const limiter = createSocketRateLimiter({ now: clock.now, capacity: 5, refillPerSecond: 2 });

    for (let i = 0; i < 5; i += 1) expect(limiter.tryConsume()).toBe(true);
    expect(limiter.tryConsume()).toBe(false);

    // 500ms at 2/s == exactly one token
    clock.advanceMs(500);
    expect(limiter.tryConsume()).toBe(true);
    expect(limiter.tryConsume()).toBe(false);
  });

  it('never accumulates beyond capacity while idle', () => {
    const clock = fakeClock();
    const limiter = createSocketRateLimiter({ now: clock.now, capacity: 3, refillPerSecond: 10 });

    clock.advanceMs(60_000);
    for (let i = 0; i < 3; i += 1) expect(limiter.tryConsume()).toBe(true);
    expect(limiter.tryConsume()).toBe(false);
  });

  it('sustains the configured rate over time', () => {
    const clock = fakeClock();
    const limiter = createSocketRateLimiter({ now: clock.now, capacity: 1, refillPerSecond: 5 });

    // 5 per second, 20 times over, allowing the burst token each window
    let accepted = 0;
    for (let s = 0; s < 20; s += 1) {
      for (let i = 0; i < 5; i += 1) {
        clock.advanceMs(200);
        if (limiter.tryConsume()) accepted += 1;
      }
    }
    expect(accepted).toBe(100);
  });

  it('stops an unbounded flood dead', () => {
    const clock = fakeClock();
    const limiter = createSocketRateLimiter({ now: clock.now });

    let accepted = 0;
    for (let i = 0; i < 1_000_000; i += 1) {
      if (limiter.tryConsume()) accepted += 1;
    }
    // No clock advance, so only the initial burst can ever be accepted.
    expect(accepted).toBe(SOCKET_RATE_LIMIT_DEFAULTS.capacity);
  });

  it('counts consecutive over-rate messages and clears on an accepted one', () => {
    const clock = fakeClock();
    const limiter = createSocketRateLimiter({ now: clock.now, capacity: 1, maxOverRate: 3 });

    expect(limiter.tryConsume()).toBe(true);
    expect(limiter.getOverRateCount()).toBe(0);

    expect(limiter.tryConsume()).toBe(false);
    expect(limiter.getOverRateCount()).toBe(1);
    expect(limiter.tryConsume()).toBe(false);
    expect(limiter.getOverRateCount()).toBe(2);
    expect(limiter.isAbusive()).toBe(false);

    // A brief burst that fits in the bucket resets the abuse counter.
    clock.advanceMs(1000);
    expect(limiter.tryConsume()).toBe(true);
    expect(limiter.getOverRateCount()).toBe(0);
    expect(limiter.isAbusive()).toBe(false);
  });

  it('reports abuse only after sustained flooding', () => {
    const clock = fakeClock();
    const limiter = createSocketRateLimiter({ now: clock.now, capacity: 1, maxOverRate: 5 });

    limiter.tryConsume();
    for (let i = 0; i < 5; i += 1) expect(limiter.tryConsume()).toBe(false);
    expect(limiter.isAbusive()).toBe(false);

    expect(limiter.tryConsume()).toBe(false);
    expect(limiter.isAbusive()).toBe(true);
  });

  it('falls back to defaults for invalid config instead of disabling the guard', () => {
    const clock = fakeClock();

    const zeroRate = createSocketRateLimiter({ now: clock.now, refillPerSecond: 0 });
    expect(zeroRate.isEnabled()).toBe(true);

    const negative = createSocketRateLimiter({ now: clock.now, capacity: -10 });
    expect(negative.isEnabled()).toBe(true);

    const nan = createSocketRateLimiter({ now: clock.now, refillPerSecond: Number.NaN });
    expect(nan.isEnabled()).toBe(true);

    // env parsing in the socket servers yields NaN for garbage input
    const garbage = createSocketRateLimiter({
      now: clock.now,
      refillPerSecond: Number('not-a-number') || undefined,
      capacity: Number('not-a-number') || undefined,
    });
    expect(garbage.isEnabled()).toBe(true);
    expect(garbage.tryConsume()).toBe(true);
  });

  it('handles a frozen or rewound clock without minting tokens', () => {
    let t = 5_000;
    const limiter = createSocketRateLimiter({ now: () => t, capacity: 2, refillPerSecond: 5 });

    expect(limiter.tryConsume()).toBe(true);
    expect(limiter.tryConsume()).toBe(true);
    expect(limiter.tryConsume()).toBe(false);

    // Clock frozen: still no tokens.
    expect(limiter.tryConsume()).toBe(false);

    // Clock rewound: must not grant tokens.
    t = 1000;
    expect(limiter.tryConsume()).toBe(false);
  });

  it('keeps separate budgets for separate connections', () => {
    const clock = fakeClock();
    const flooder = createSocketRateLimiter({ now: clock.now, capacity: 2 });
    const honest = createSocketRateLimiter({ now: clock.now, capacity: 2 });

    for (let i = 0; i < 50; i += 1) flooder.tryConsume();
    expect(flooder.tryConsume()).toBe(false);

    // A flooding peer must not consume an honest peer's budget.
    expect(honest.tryConsume()).toBe(true);
    expect(honest.tryConsume()).toBe(true);
  });
});