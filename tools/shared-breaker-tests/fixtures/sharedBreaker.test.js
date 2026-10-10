import { afterEach, describe, expect, it, vi } from 'vitest';
import { CircuitBreaker, CircuitState } from '../../src/lib/circuitBreaker.js';
const breakers = [];
function breaker(options = {}) {
  const b = new CircuitBreaker('owned', {
    failureThreshold: 1,
    resetTimeoutMs: 100000,
    requestTimeoutMs: 100000,
    ...options,
  });
  breakers.push(b);
  return b;
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
async function trip(b) {
  await b.execute(() => Promise.reject(new Error('outage'))).catch(() => {});
}
function recover(b) {
  b.nextAttempt = 0;
  expect(b.getState()).toBe(CircuitState.HALF_OPEN);
}
afterEach(() => {
  breakers.splice(0).forEach((b) => b.destroy());
  vi.useRealTimers();
});

describe('captured shared-breaker ownership', () => {
  it('old CLOSED success cannot close a newer pending recovery probe', async () => {
    const b = breaker(),
      old = deferred(),
      trial = deferred();
    const first = b.execute(() => old.promise);
    await trip(b);
    recover(b);
    const probe = b.execute(() => trial.promise);
    old.resolve('old');
    expect(await first).toBe('old');
    expect(b.getState()).toBe(CircuitState.HALF_OPEN);
    const extra = vi.fn();
    await expect(b.execute(extra)).rejects.toThrow('probe in flight');
    expect(extra).not.toHaveBeenCalled();
    trial.resolve('recovered');
    expect(await probe).toBe('recovered');
    expect(b.getState()).toBe(CircuitState.CLOSED);
  });
  it('old CLOSED failure cannot reopen a successfully recovered generation', async () => {
    const b = breaker(),
      old = deferred();
    const first = b.execute(() => old.promise).catch((e) => e);
    await trip(b);
    recover(b);
    await b.execute(() => Promise.resolve('recovered'));
    old.reject(new Error('old failure'));
    expect((await first).message).toBe('old failure');
    expect(b.getState()).toBe(CircuitState.CLOSED);
    expect(b.failureCount).toBe(0);
  });
  it('reset fences a pending old success from resetting newer failure history', async () => {
    const b = breaker({ failureThreshold: 2 }),
      old = deferred();
    const first = b.execute(() => old.promise);
    b.reset();
    await trip(b);
    expect(b.failureCount).toBe(1);
    old.resolve('old');
    await first;
    expect(b.failureCount).toBe(1);
  });
  it('reset fences a pending old rejection from reopening fresh state', async () => {
    const b = breaker(),
      old = deferred();
    const first = b.execute(() => old.promise).catch((e) => e);
    b.reset();
    old.reject(new Error('old'));
    await first;
    expect(b.state).toBe(CircuitState.CLOSED);
    expect(b.failureCount).toBe(0);
  });
  it.each([true, false])(
    'retains native ownership after caller timeout (count=%s)',
    async (count) => {
      vi.useFakeTimers();
      const b = breaker({ requestTimeoutMs: 10, countTimeoutAsFailure: count }),
        native = deferred();
      await trip(b);
      recover(b);
      const timed = b.execute(() => native.promise).catch((e) => e);
      await vi.advanceTimersByTimeAsync(11);
      expect((await timed).message).toContain('timed out');
      if (count) recover(b);
      const extra = vi.fn();
      await expect(b.execute(extra)).rejects.toThrow('probe in flight');
      expect(extra).not.toHaveBeenCalled();
      native.resolve('late');
      await Promise.resolve();
      await Promise.resolve();
      expect(await b.execute(() => Promise.resolve('fresh'))).toBe('fresh');
      expect(b.state).toBe(CircuitState.CLOSED);
    },
  );
  it.each(['resolve', 'reject'])(
    'late native %s releases only its owner without changing timed-out health',
    async (outcome) => {
      vi.useFakeTimers();
      const b = breaker({ requestTimeoutMs: 10 }),
        native = deferred();
      await trip(b);
      recover(b);
      const timed = b.execute(() => native.promise).catch((e) => e);
      await vi.advanceTimersByTimeAsync(11);
      await timed;
      const metrics = b.getMetrics();
      native[outcome](outcome === 'resolve' ? 'late' : new Error('late'));
      await Promise.resolve();
      await Promise.resolve();
      expect(b.getMetrics()).toEqual(metrics);
    },
  );
  it('manual reset cannot erase native recovery ownership across a new outage', async () => {
    const b = breaker(),
      native = deferred();
    await trip(b);
    recover(b);
    const old = b.execute(() => native.promise);
    b.reset();
    await trip(b);
    recover(b);
    const extra = vi.fn();
    await expect(b.execute(extra)).rejects.toThrow('probe in flight');
    expect(extra).not.toHaveBeenCalled();
    native.resolve('old');
    await old;
    expect(b.state).toBe(CircuitState.HALF_OPEN);
    await b.execute(() => Promise.resolve('fresh'));
    expect(b.state).toBe(CircuitState.CLOSED);
  });
  it('stale failure keeps its caller fallback without corrupting recovered health', async () => {
    const fallback = vi.fn((arg) => `fallback:${arg}`),
      b = breaker({ fallback }),
      native = deferred();
    const old = b.execute(() => native.promise, 'old');
    await trip(b);
    recover(b);
    await b.execute(() => Promise.resolve('fresh'));
    native.reject(new Error('old'));
    expect(await old).toBe('fallback:old');
    expect(b.state).toBe(CircuitState.CLOSED);
  });
  it('throwing fallback cannot strand a completed recovery probe', async () => {
    const b = breaker({
      fallback: () => {
        throw new Error('fallback failure');
      },
    });
    await trip(b);
    recover(b);
    await expect(
      b.execute(() => {
        throw new Error('provider');
      }),
    ).rejects.toThrow('fallback failure');
    recover(b);
    expect(await b.execute(() => Promise.resolve('fresh'))).toBe('fresh');
  });
  it('native non-cooperative timed-out probe blocks another backoff-window probe', async () => {
    const b = breaker({ requestTimeoutMs: 10, resetTimeoutMs: 15 }),
      native = deferred();
    await trip(b);
    await new Promise((r) => setTimeout(r, 20));
    let signal;
    const first = b
      .execute(({ signal: s }) => {
        signal = s;
        return native.promise;
      })
      .catch((e) => e);
    await new Promise((r) => setTimeout(r, 20));
    await first;
    expect(signal.aborted).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    const extra = vi.fn();
    await expect(b.execute(extra)).rejects.toThrow('probe in flight');
    expect(extra).not.toHaveBeenCalled();
    native.resolve('late');
  });
});

it('blocked native-owner recovery returns fallback without provider dispatch', async () => {
  vi.useFakeTimers();
  const fallback = vi.fn((arg) => `fallback:${arg}`),
    b = breaker({ requestTimeoutMs: 10, fallback }),
    native = deferred();
  await trip(b);
  recover(b);
  const first = b.execute(() => native.promise, 'first');
  await vi.advanceTimersByTimeAsync(11);
  expect(await first).toBe('fallback:first');
  recover(b);
  const extra = vi.fn();
  expect(await b.execute(extra, 'second')).toBe('fallback:second');
  expect(extra).not.toHaveBeenCalled();
  native.resolve('late');
});
it('cooperative abort rejection releases probe and preserves timeout accounting', async () => {
  vi.useFakeTimers();
  const b = breaker({ requestTimeoutMs: 10, countTimeoutAsFailure: false });
  await trip(b);
  recover(b);
  const result = b
    .execute(
      ({ signal }) =>
        new Promise((resolve, reject) =>
          signal.addEventListener(
            'abort',
            () => reject(new Error('aborted provider')),
            { once: true },
          ),
        ),
    )
    .catch((e) => e);
  await vi.advanceTimersByTimeAsync(11);
  expect(await result).toBeInstanceOf(Error);
  expect(b.timeoutCount).toBe(1);
  expect(await b.execute(() => Promise.resolve('recovered'))).toBe('recovered');
  expect(b.state).toBe(CircuitState.CLOSED);
});
it('destroy fences pending native failure from changing freshly reset health', async () => {
  const b = breaker(),
    native = deferred();
  const old = b.execute(() => native.promise).catch((e) => e);
  b.destroy();
  native.reject(new Error('old'));
  expect((await old).message).toBe('old');
  expect(b.getMetrics()).toEqual({
    state: CircuitState.CLOSED,
    failureCount: 0,
    timeoutCount: 0,
    successCount: 0,
  });
});
