/**
 * CircuitBreaker timeout handling (#11360) and half-open timer (#9937).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { CircuitBreaker, CircuitState } from '../../src/lib/circuitBreaker.js';

const breakers = [];
function makeBreaker(name, options) {
  const breaker = new CircuitBreaker(name, options);
  breakers.push(breaker);
  return breaker;
}

const slowFn = () => new Promise((resolve) => setTimeout(resolve, 200));

describe('CircuitBreaker timeouts', () => {
  afterEach(() => {
    while (breakers.length) breakers.pop().destroy();
  });

  it('passes an AbortSignal to the wrapped function', async () => {
    const breaker = makeBreaker('signal', { requestTimeoutMs: 1000 });
    let capturedSignal = null;
    const fn = vi.fn().mockImplementation(async ({ signal }) => {
      capturedSignal = signal;
      return 'ok';
    });

    await breaker.execute(fn);

    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    expect(capturedSignal.aborted).toBe(false);
  });

  it('aborts the underlying request when it times out', async () => {
    const breaker = makeBreaker('abort', { requestTimeoutMs: 50 });
    let capturedSignal = null;
    const fn = ({ signal }) => {
      capturedSignal = signal;
      return new Promise((resolve) => setTimeout(resolve, 200));
    };

    await expect(breaker.execute(fn)).rejects.toThrow('Request timed out after 50ms');

    expect(capturedSignal.aborted).toBe(true);
  });

  it('counts a timeout as a failure by default', async () => {
    const breaker = makeBreaker('timeout-is-failure', { requestTimeoutMs: 50, failureThreshold: 1 });

    await expect(breaker.execute(slowFn)).rejects.toThrow('Request timed out after 50ms');

    expect(breaker.getState()).toBe(CircuitState.OPEN);
    expect(breaker.failureCount).toBe(1);
    expect(breaker.timeoutCount).toBe(1);
  });

  it('does not open the circuit on timeouts when countTimeoutAsFailure is false', async () => {
    const breaker = makeBreaker('timeout-not-failure', {
      requestTimeoutMs: 50,
      failureThreshold: 2,
      countTimeoutAsFailure: false,
    });

    await expect(breaker.execute(slowFn)).rejects.toThrow('Request timed out after 50ms');
    await expect(breaker.execute(slowFn)).rejects.toThrow('Request timed out after 50ms');

    expect(breaker.getState()).toBe(CircuitState.CLOSED);
    expect(breaker.failureCount).toBe(0);
    expect(breaker.timeoutCount).toBe(2);
  });

  it('still opens on real failures when countTimeoutAsFailure is false', async () => {
    const breaker = makeBreaker('real-failures', {
      requestTimeoutMs: 50,
      failureThreshold: 2,
      countTimeoutAsFailure: false,
    });
    const failFn = vi.fn().mockRejectedValue(new Error('Actual failure'));

    await expect(breaker.execute(failFn)).rejects.toThrow('Actual failure');
    await expect(breaker.execute(failFn)).rejects.toThrow('Actual failure');

    expect(breaker.getState()).toBe(CircuitState.OPEN);
    expect(breaker.timeoutCount).toBe(0);
  });

  it('reports successes, timeouts and failures in getMetrics()', async () => {
    const breaker = makeBreaker('metrics', {
      requestTimeoutMs: 50,
      failureThreshold: 2,
      countTimeoutAsFailure: false,
    });

    await breaker.execute(vi.fn().mockResolvedValue('ok'));
    await breaker.execute(vi.fn().mockResolvedValue('ok'));
    await expect(breaker.execute(slowFn)).rejects.toThrow();
    await expect(breaker.execute(vi.fn().mockRejectedValue(new Error('Failure')))).rejects.toThrow();

    expect(breaker.getMetrics()).toEqual({
      state: CircuitState.CLOSED,
      successCount: 2,
      timeoutCount: 1,
      failureCount: 1,
    });
  });

  it('does not keep the process alive with the half-open timer (#9937)', async () => {
    const breaker = makeBreaker('half-open-timer', { failureThreshold: 1, resetTimeoutMs: 30000 });

    await expect(breaker.execute(vi.fn().mockRejectedValue(new Error('down')))).rejects.toThrow('down');

    expect(breaker.getState()).toBe(CircuitState.OPEN);
    expect(breaker._halfOpenTimer).not.toBeNull();
    expect(breaker._halfOpenTimer.hasRef()).toBe(false);
  });
});
