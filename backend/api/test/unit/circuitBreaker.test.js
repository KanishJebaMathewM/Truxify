import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CircuitBreaker, CircuitState } from '../../src/lib/circuitBreaker.js';

describe('CircuitBreaker Unit Tests', () => {
  it('starts in CLOSED state and executes function successfully', async () => {
    const breaker = new CircuitBreaker('testBreaker');
    const fn = vi.fn().mockResolvedValue('ok');

    const res = await breaker.execute(fn);

    expect(res).toBe('ok');
    expect(breaker.getState()).toBe(CircuitState.CLOSED);
  });

  it('opens circuit after reaching failure threshold', async () => {
    const breaker = new CircuitBreaker('testThresholdBreaker', {
      failureThreshold: 2,
      resetTimeoutMs: 10000,
    });
    const fn = vi.fn().mockRejectedValue(new Error('Network error'));

    await expect(breaker.execute(fn)).rejects.toThrow('Network error');
    expect(breaker.getState()).toBe(CircuitState.CLOSED);

    await expect(breaker.execute(fn)).rejects.toThrow('Network error');
    expect(breaker.getState()).toBe(CircuitState.OPEN);
  });

  it('uses fallback function when circuit is OPEN', async () => {
    const fallback = vi.fn().mockReturnValue('fallback-data');
    const breaker = new CircuitBreaker('testFallbackBreaker', {
      failureThreshold: 1,
      fallback,
    });
    const fn = vi.fn().mockRejectedValue(new Error('Downstream offline'));

    const res1 = await breaker.execute(fn);
    expect(res1).toBe('fallback-data');
    expect(breaker.getState()).toBe(CircuitState.OPEN);

    const res2 = await breaker.execute(fn);
    expect(res2).toBe('fallback-data');
    expect(fn).toHaveBeenCalledTimes(1); // Function not invoked when OPEN
  });

  it('cleans up half-open timer when reset is called externally', () => {
    const breaker = new CircuitBreaker('testTimerCleanup', {
      failureThreshold: 1,
      resetTimeoutMs: 10000,
      fallback: () => 'fallback',
    });

    // Open the circuit via onFailure (threshold=1 so first failure opens it)
    breaker.onFailure(new Error('Fail'), []);

    // Verify timer was scheduled
    expect(breaker._halfOpenTimer).not.toBeNull();
    expect(breaker.state).toBe(CircuitState.OPEN);

    // Call reset externally (simulating an external/manual reset)
    breaker.reset();

    // Timer should be cleared
    expect(breaker._halfOpenTimer).toBeNull();
    expect(breaker.state).toBe(CircuitState.CLOSED);
  });

  it('transitions to HALF_OPEN after resetTimeoutMs expires', async () => {
    const breaker = new CircuitBreaker('testHalfOpenBreaker', {
      failureThreshold: 1,
      resetTimeoutMs: 100,
    });
    const fnFail = vi.fn().mockRejectedValue(new Error('Error'));
    await expect(breaker.execute(fnFail)).rejects.toThrow();

    expect(breaker.getState()).toBe(CircuitState.OPEN);

    await new Promise((r) => setTimeout(r, 120));

    expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);

    const fnSuccess = vi.fn().mockResolvedValue('recovered');
    const res = await breaker.execute(fnSuccess);
    expect(res).toBe('recovered');
    expect(breaker.getState()).toBe(CircuitState.CLOSED);
  });

  it('cleans up resources and resets state when destroy is called', () => {
    const breaker = new CircuitBreaker('testDestroyBreaker', {
      failureThreshold: 1,
      resetTimeoutMs: 10000,
      fallback: () => 'fallback',
    });
    breaker.onFailure(new Error('Fail'), []);
    expect(breaker._halfOpenTimer).not.toBeNull();
    expect(breaker.state).toBe(CircuitState.OPEN);

    breaker.destroy();

    expect(breaker._halfOpenTimer).toBeNull();
    expect(breaker.state).toBe(CircuitState.CLOSED);
    expect(breaker.failureCount).toBe(0);
  });

  it('triggers request timeout when execution exceeds requestTimeoutMs', async () => {
    const breaker = new CircuitBreaker('testTimeoutBreaker', {
      requestTimeoutMs: 50,
    });
    const slowFn = () => new Promise((resolve) => setTimeout(resolve, 200));

    await expect(breaker.execute(slowFn)).rejects.toThrow('Request timed out after 50ms');
  });

  it('passes arguments to fallback function on failure', async () => {
    const fallback = vi.fn((arg1, arg2) => `fallback:${arg1}:${arg2}`);
    const breaker = new CircuitBreaker('testFallbackArgsBreaker', {
      failureThreshold: 1,
      fallback,
    });
    const fnFail = vi.fn().mockRejectedValue(new Error('Failure'));

    const result = await breaker.execute(fnFail, 'val1', 42);

    expect(result).toBe('fallback:val1:42');
    expect(fallback).toHaveBeenCalledWith('val1', 42);
  });

  it('passes AbortSignal to the wrapped function', async () => {
    const breaker = new CircuitBreaker('testSignalBreaker', {
      requestTimeoutMs: 1000,
    });
    let capturedSignal = null;
    const fn = vi.fn().mockImplementation(async ({ signal }) => {
      capturedSignal = signal;
      return 'ok';
    });

    await breaker.execute(fn);

    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    expect(capturedSignal.aborted).toBe(false);
  });

  it('does not count timeout as failure when countTimeoutAsFailure is false', async () => {
    const breaker = new CircuitBreaker('testTimeoutNotFailure', {
      requestTimeoutMs: 50,
      failureThreshold: 1,
      countTimeoutAsFailure: false,
    });
    const slowFn = () => new Promise((resolve) => setTimeout(resolve, 200));

    await expect(breaker.execute(slowFn)).rejects.toThrow('Request timed out after 50ms');

    expect(breaker.getState()).toBe(CircuitState.CLOSED);
    expect(breaker.failureCount).toBe(0);
    expect(breaker.timeoutCount).toBe(1);
  });

  it('counts timeout as failure when countTimeoutAsFailure is true (default)', async () => {
    const breaker = new CircuitBreaker('testTimeoutIsFailure', {
      requestTimeoutMs: 50,
      failureThreshold: 1,
      countTimeoutAsFailure: true,
    });
    const slowFn = () => new Promise((resolve) => setTimeout(resolve, 200));

    await expect(breaker.execute(slowFn)).rejects.toThrow('Request timed out after 50ms');

    expect(breaker.getState()).toBe(CircuitState.OPEN);
    expect(breaker.failureCount).toBe(1);
    expect(breaker.timeoutCount).toBe(1);
  });

  it('does not open circuit on timeout when countTimeoutAsFailure is false even with multiple timeouts', async () => {
    const breaker = new CircuitBreaker('testMultipleTimeouts', {
      requestTimeoutMs: 50,
      failureThreshold: 2,
      countTimeoutAsFailure: false,
    });
    const slowFn = () => new Promise((resolve) => setTimeout(resolve, 200));

    await expect(breaker.execute(slowFn)).rejects.toThrow('Request timed out after 50ms');
    await expect(breaker.execute(slowFn)).rejects.toThrow('Request timed out after 50ms');

    expect(breaker.getState()).toBe(CircuitState.CLOSED);
    expect(breaker.failureCount).toBe(0);
    expect(breaker.timeoutCount).toBe(2);
  });

  it('opens circuit on actual failures even when countTimeoutAsFailure is false', async () => {
    const breaker = new CircuitBreaker('testActualFailuresOpen', {
      requestTimeoutMs: 50,
      failureThreshold: 2,
      countTimeoutAsFailure: false,
    });
    const failFn = vi.fn().mockRejectedValue(new Error('Actual failure'));

    await expect(breaker.execute(failFn)).rejects.toThrow('Actual failure');
    await expect(breaker.execute(failFn)).rejects.toThrow('Actual failure');

    expect(breaker.getState()).toBe(CircuitState.OPEN);
    expect(breaker.failureCount).toBe(2);
    expect(breaker.timeoutCount).toBe(0);
  });

  it('tracks metrics including timeout count', async () => {
    const breaker = new CircuitBreaker('testMetrics', {
      requestTimeoutMs: 50,
      failureThreshold: 2,
      countTimeoutAsFailure: false,
    });
    const slowFn = () => new Promise((resolve) => setTimeout(resolve, 200));
    const failFn = vi.fn().mockRejectedValue(new Error('Failure'));

    await breaker.execute(vi.fn().mockResolvedValue('ok'));
    await breaker.execute(vi.fn().mockResolvedValue('ok'));
    await expect(breaker.execute(slowFn)).rejects.toThrow();
    await expect(breaker.execute(failFn)).rejects.toThrow();

    const metrics = breaker.getMetrics();
    expect(metrics.state).toBe(CircuitState.CLOSED);
    expect(metrics.successCount).toBe(2);
    expect(metrics.timeoutCount).toBe(1);
    expect(metrics.failureCount).toBe(1);
  });

  it('does not count timeout as failure if the underlying promise later resolves', async () => {
    const breaker = new CircuitBreaker('testLateResolve', {
      requestTimeoutMs: 50,
      failureThreshold: 1,
      countTimeoutAsFailure: false,
    });

    let resolveSlow;
    const slowPromise = new Promise((resolve) => {
      resolveSlow = resolve;
    });
    const fn = vi.fn().mockReturnValue(slowPromise);

    const executePromise = breaker.execute(fn);

    await expect(executePromise).rejects.toThrow('Request timed out after 50ms');
    expect(breaker.getState()).toBe(CircuitState.CLOSED);
    expect(breaker.failureCount).toBe(0);
    expect(breaker.timeoutCount).toBe(1);

    resolveSlow('late result');
    await slowPromise;
  });
});
