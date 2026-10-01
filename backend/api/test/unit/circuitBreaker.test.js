import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CircuitBreaker, CircuitState } from '../../src/lib/circuitBreaker.js';

describe('CircuitBreaker Unit Tests', () => {
  let cb;

  beforeEach(() => {
    cb = new CircuitBreaker('test', { failureThreshold: 3, resetTimeoutMs: 1000 });
  });

  afterEach(() => {
    cb.destroy();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('initializes with default options', () => {
      const defaultCb = new CircuitBreaker('default');
      expect(defaultCb.name).toBe('default');
      expect(defaultCb.failureThreshold).toBe(5);
      expect(defaultCb.resetTimeoutMs).toBe(30000);
      expect(defaultCb.requestTimeoutMs).toBe(5000);
      expect(defaultCb.countTimeoutAsFailure).toBe(true);
      expect(defaultCb.state).toBe(CircuitState.CLOSED);
      expect(defaultCb.failureCount).toBe(0);
      expect(defaultCb.successCount).toBe(0);
      expect(defaultCb.timeoutCount).toBe(0);
      defaultCb.destroy();
    });

    it('accepts custom options', () => {
      const customCb = new CircuitBreaker('custom', {
        failureThreshold: 2,
        resetTimeoutMs: 5000,
        requestTimeoutMs: 2000,
        countTimeoutAsFailure: false,
      });
      expect(customCb.failureThreshold).toBe(2);
      expect(customCb.resetTimeoutMs).toBe(5000);
      expect(customCb.requestTimeoutMs).toBe(2000);
      expect(customCb.countTimeoutAsFailure).toBe(false);
      customCb.destroy();
    });

    it('defaults name to "defaultCircuitBreaker" when not provided', () => {
      const unnamedCb = new CircuitBreaker();
      expect(unnamedCb.name).toBe('defaultCircuitBreaker');
      unnamedCb.destroy();
    });
  });

  describe('getState', () => {
    it('returns CLOSED initially', () => {
      expect(cb.getState()).toBe(CircuitState.CLOSED);
    });

    it('transitions from OPEN to HALF_OPEN when nextAttempt is reached', () => {
      cb.state = CircuitState.OPEN;
      cb.nextAttempt = Date.now() - 100;
      expect(cb.getState()).toBe(CircuitState.HALF_OPEN);
    });
  });

  describe('execute', () => {
    it('executes a successful function and returns result', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      const result = await cb.execute(fn, 'arg1');
      expect(result).toBe('success');
      // The breaker appends { signal } so the call can be aborted on timeout (#11360).
      expect(fn).toHaveBeenCalledWith('arg1', { signal: expect.any(AbortSignal) });
    });

    it('throws TypeError when fn is not a function', async () => {
      await expect(cb.execute('not a function')).rejects.toThrow(TypeError);
      await expect(cb.execute(null)).rejects.toThrow('circuitBreaker execute: fn must be a function');
    });

    it('records failure when fn throws', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('boom'));
      await expect(cb.execute(failingFn)).rejects.toThrow('boom');
      expect(cb.failureCount).toBe(1);
    });

    it('opens circuit after failureThreshold is reached', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('boom'));
      for (let i = 0; i < cb.failureThreshold; i++) {
        await expect(cb.execute(failingFn)).rejects.toThrow('boom');
      }
      expect(cb.state).toBe(CircuitState.OPEN);
    });

    it('rejects requests immediately when circuit is OPEN', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('boom'));
      for (let i = 0; i < cb.failureThreshold; i++) {
        await expect(cb.execute(failingFn)).rejects.toThrow();
      }
      expect(cb.state).toBe(CircuitState.OPEN);
      vi.clearAllMocks();
      const safeFn = vi.fn().mockResolvedValue('should not run');
      await expect(cb.execute(safeFn)).rejects.toThrow('CircuitBreaker:test is OPEN');
      expect(safeFn).not.toHaveBeenCalled();
    });

    it('uses fallback when circuit is OPEN and fallback is provided', async () => {
      const fallback = vi.fn().mockReturnValue('fallback result');
      const cbWithFallback = new CircuitBreaker('test-fb', {
        failureThreshold: 2,
        fallback,
      });
      const failingFn = vi.fn().mockRejectedValue(new Error('boom'));
      const result1 = await cbWithFallback.execute(failingFn);
      expect(result1).toBe('fallback result');
      expect(failingFn).toHaveBeenCalledTimes(1);
      const result2 = await cbWithFallback.execute(failingFn);
      expect(result2).toBe('fallback result');
      expect(failingFn).toHaveBeenCalledTimes(2);
      const result3 = await cbWithFallback.execute(vi.fn());
      expect(result3).toBe('fallback result');
      expect(cbWithFallback.state).toBe(CircuitState.OPEN);
      cbWithFallback.destroy();
    });

    it('handles synchronous throw correctly without leaving timer undefined', async () => {
      const syncThrowFn = vi.fn().mockImplementation(() => {
        throw new Error('sync boom');
      });
      await expect(cb.execute(syncThrowFn)).rejects.toThrow('sync boom');
      expect(cb.failureCount).toBe(1);
    });
  });

  describe('AbortSignal & Timeout Cancellation', () => {
    it('passes AbortSignal to wrapped function and aborts it when timeout occurs', async () => {
      const breaker = new CircuitBreaker('testSignal', { requestTimeoutMs: 50 });
      let capturedSignal = null;
      const slowFn = vi.fn().mockImplementation(async ({ signal }) => {
        capturedSignal = signal;
        await new Promise((resolve) => setTimeout(resolve, 200));
      });

      await expect(breaker.execute(slowFn)).rejects.toThrow('[CircuitBreaker:testSignal] Request timed out after 50ms');
      expect(capturedSignal).toBeInstanceOf(AbortSignal);
      expect(capturedSignal.aborted).toBe(true);
      breaker.destroy();
    });

    it('rejects caller with expected timeout error', async () => {
      const breaker = new CircuitBreaker('testTimeoutErr', { requestTimeoutMs: 50 });
      const slowFn = () => new Promise((resolve) => setTimeout(resolve, 200));
      await expect(breaker.execute(slowFn)).rejects.toThrow('[CircuitBreaker:testTimeoutErr] Request timed out after 50ms');
      breaker.destroy();
    });

    it('does not allow late completion of a timed-out operation to change breaker state', async () => {
      const breaker = new CircuitBreaker('testLateComplete', {
        requestTimeoutMs: 50,
        failureThreshold: 1,
        countTimeoutAsFailure: false,
      });

      let resolveSlow;
      const slowPromise = new Promise((resolve) => {
        resolveSlow = resolve;
      });
      const fn = vi.fn().mockReturnValue(slowPromise);

      await expect(breaker.execute(fn)).rejects.toThrow('Request timed out after 50ms');
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
      expect(breaker.failureCount).toBe(0);

      resolveSlow('late result');
      await slowPromise;

      expect(breaker.getState()).toBe(CircuitState.CLOSED);
      expect(breaker.failureCount).toBe(0);
      breaker.destroy();
    });

    it('does not cause an unhandled promise rejection if a timed-out operation later rejects', async () => {
      const breaker = new CircuitBreaker('testLateReject', {
        requestTimeoutMs: 50,
        countTimeoutAsFailure: false,
      });

      let rejectSlow;
      const slowPromise = new Promise((_, reject) => {
        rejectSlow = reject;
      });
      const fn = vi.fn().mockReturnValue(slowPromise);

      await expect(breaker.execute(fn)).rejects.toThrow('Request timed out after 50ms');

      let unhandledEmitted = false;
      const onUnhandled = () => {
        unhandledEmitted = true;
      };
      process.on('unhandledRejection', onUnhandled);

      rejectSlow(new Error('Late rejection error'));
      await new Promise((r) => setTimeout(r, 50));

      process.removeListener('unhandledRejection', onUnhandled);
      expect(unhandledEmitted).toBe(false);
      breaker.destroy();
    });
  });

  describe('Timeout Configuration & Metrics', () => {
    it('counts timeout as failure when countTimeoutAsFailure is true (default)', async () => {
      const breaker = new CircuitBreaker('testTimeoutFailureTrue', {
        requestTimeoutMs: 50,
        failureThreshold: 1,
        countTimeoutAsFailure: true,
      });
      const slowFn = () => new Promise((resolve) => setTimeout(resolve, 200));

      await expect(breaker.execute(slowFn)).rejects.toThrow('Request timed out after 50ms');
      expect(breaker.getState()).toBe(CircuitState.OPEN);
      expect(breaker.failureCount).toBe(1);
      expect(breaker.timeoutCount).toBe(1);
      breaker.destroy();
    });

    it('does not count timeout as failure when countTimeoutAsFailure is false', async () => {
      const breaker = new CircuitBreaker('testTimeoutFailureFalse', {
        requestTimeoutMs: 50,
        failureThreshold: 1,
        countTimeoutAsFailure: false,
      });
      const slowFn = () => new Promise((resolve) => setTimeout(resolve, 200));

      await expect(breaker.execute(slowFn)).rejects.toThrow('Request timed out after 50ms');
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
      expect(breaker.failureCount).toBe(0);
      expect(breaker.timeoutCount).toBe(1);
      breaker.destroy();
    });

    it('increments successCount on success and timeoutCount on timeout', async () => {
      const breaker = new CircuitBreaker('testCounts', { requestTimeoutMs: 50, countTimeoutAsFailure: false });
      const successFn = vi.fn().mockResolvedValue('ok');
      const slowFn = () => new Promise((resolve) => setTimeout(resolve, 200));

      await breaker.execute(successFn);
      expect(breaker.successCount).toBe(1);

      await expect(breaker.execute(slowFn)).rejects.toThrow();
      expect(breaker.timeoutCount).toBe(1);
      breaker.destroy();
    });

    it('returns expected metrics structure from getMetrics()', async () => {
      const breaker = new CircuitBreaker('testMetrics', { requestTimeoutMs: 50, countTimeoutAsFailure: false });
      const successFn = vi.fn().mockResolvedValue('ok');
      const failFn = vi.fn().mockRejectedValue(new Error('err'));
      const slowFn = () => new Promise((resolve) => setTimeout(resolve, 200));

      await breaker.execute(successFn);
      await expect(breaker.execute(failFn)).rejects.toThrow();
      await expect(breaker.execute(slowFn)).rejects.toThrow();

      expect(breaker.getMetrics()).toEqual({
        state: CircuitState.CLOSED,
        failureCount: 1,
        timeoutCount: 1,
        successCount: 1,
      });
      breaker.destroy();
    });
  });

  describe('Half-Open Timer & Single Probe Safety', () => {
    it('unrefs half-open timer when supported', () => {
      vi.useFakeTimers();
      const breaker = new CircuitBreaker('testUnref', { resetTimeoutMs: 1000 });
      breaker.state = CircuitState.OPEN;

      const mockTimer = { unref: vi.fn() };
      vi.spyOn(global, 'setTimeout').mockReturnValue(mockTimer);

      breaker._scheduleHalfOpen();

      expect(mockTimer.unref).toHaveBeenCalled();
      breaker.destroy();
    });

    it('functions correctly when unref() is unavailable on half-open timer', () => {
      vi.useFakeTimers();
      const breaker = new CircuitBreaker('testNoUnref', { resetTimeoutMs: 1000 });
      breaker.state = CircuitState.OPEN;

      const mockTimer = {};
      vi.spyOn(global, 'setTimeout').mockReturnValue(mockTimer);

      expect(() => breaker._scheduleHalfOpen()).not.toThrow();
      breaker.destroy();
    });

    it('preserves single-probe behavior in HALF_OPEN state', async () => {
      const breaker = new CircuitBreaker('testSingleProbe', { failureThreshold: 1, resetTimeoutMs: 1000 });
      const failFn = vi.fn().mockRejectedValue(new Error('fail'));

      await expect(breaker.execute(failFn)).rejects.toThrow('fail');
      expect(breaker.state).toBe(CircuitState.OPEN);

      breaker.state = CircuitState.HALF_OPEN;

      let resolveProbe;
      const probePromise = new Promise((resolve) => {
        resolveProbe = resolve;
      });
      const slowFn = vi.fn().mockReturnValue(probePromise);

      const exec1 = breaker.execute(slowFn);

      await expect(breaker.execute(vi.fn())).rejects.toThrow('HALF_OPEN (probe in flight)');

      resolveProbe('probe success');
      await exec1;

      expect(breaker.state).toBe(CircuitState.CLOSED);
      breaker.destroy();
    });

    it('does not allow a timed-out probe to release probe flag while still running', async () => {
      const breaker = new CircuitBreaker('testTimedOutProbeFlag', {
        requestTimeoutMs: 50,
        countTimeoutAsFailure: false,
      });

      breaker.state = CircuitState.HALF_OPEN;

      let resolveSlow;
      const slowPromise = new Promise((resolve) => {
        resolveSlow = resolve;
      });
      const slowFn = vi.fn().mockReturnValue(slowPromise);

      const exec1 = breaker.execute(slowFn);
      await expect(exec1).rejects.toThrow('Request timed out after 50ms');

      // The probe timed out, but slowPromise has NOT settled yet.
      // Another request in HALF_OPEN must be rejected because the probe is still in flight!
      await expect(breaker.execute(vi.fn())).rejects.toThrow('HALF_OPEN (probe in flight)');

      // Once slowPromise settles:
      resolveSlow('done');
      await slowPromise;
      await new Promise((r) => setTimeout(r, 10));

      // Now probe flag should be released:
      const okFn = vi.fn().mockResolvedValue('ok');
      const res = await breaker.execute(okFn);
      expect(res).toBe('ok');
      breaker.destroy();
    });

    it('prevents a stale settling probe from releasing a newer probe flag', async () => {
      const breaker = new CircuitBreaker('testStaleProbeToken', {
        requestTimeoutMs: 50,
        countTimeoutAsFailure: false,
      });

      breaker.state = CircuitState.HALF_OPEN;

      let resolveProbe1;
      const probe1Promise = new Promise((r) => { resolveProbe1 = r; });
      const exec1 = breaker.execute(() => probe1Promise);
      await expect(exec1).rejects.toThrow('Request timed out after 50ms');

      // Manual reset simulates reset/new probe cycle
      breaker.reset();
      breaker.state = CircuitState.HALF_OPEN;

      let resolveProbe2;
      const probe2Promise = new Promise((r) => { resolveProbe2 = r; });
      const exec2 = breaker.execute(() => probe2Promise);

      // Late resolution of probe1 must NOT clear probe2's flag
      resolveProbe1('stale probe 1');
      await probe1Promise;
      await new Promise((r) => setTimeout(r, 10));

      // Attempting another probe while probe 2 is in flight must still fail
      await expect(breaker.execute(vi.fn())).rejects.toThrow('HALF_OPEN (probe in flight)');

      resolveProbe2('probe 2 ok');
      await exec2;
      breaker.destroy();
    });

    it('blocks a new probe after OPEN to HALF_OPEN transition when timed-out probe is still running (countTimeoutAsFailure = true)', async () => {
      const breaker = new CircuitBreaker('testOpenToHalfOpenProbeBlock', {
        requestTimeoutMs: 50,
        failureThreshold: 1,
        resetTimeoutMs: 100,
        countTimeoutAsFailure: true,
      });

      breaker.state = CircuitState.HALF_OPEN;

      let resolveSlow;
      const slowPromise = new Promise((resolve) => { resolveSlow = resolve; });
      const slowFn = vi.fn().mockReturnValue(slowPromise);

      // Probe times out and countTimeoutAsFailure=true opens circuit
      await expect(breaker.execute(slowFn)).rejects.toThrow('Request timed out after 50ms');
      expect(breaker.state).toBe(CircuitState.OPEN);

      // Simulate transition to HALF_OPEN
      breaker.nextAttempt = Date.now() - 10;
      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);

      // Since slowPromise is STILL running, new request in HALF_OPEN must be rejected
      await expect(breaker.execute(vi.fn())).rejects.toThrow('HALF_OPEN (probe in flight)');

      resolveSlow('finally done');
      await slowPromise;
      await new Promise((r) => setTimeout(r, 10));

      breaker.destroy();
    });

    it('records successCount as 1 on a successful HALF_OPEN recovery probe', async () => {
      const breaker = new CircuitBreaker('testHalfOpenSuccessCount', { failureThreshold: 1, resetTimeoutMs: 1000 });
      breaker.state = CircuitState.HALF_OPEN;

      const probeFn = vi.fn().mockResolvedValue('recovered');
      const result = await breaker.execute(probeFn);

      expect(result).toBe('recovered');
      expect(breaker.state).toBe(CircuitState.CLOSED);
      expect(breaker.successCount).toBe(1);
      expect(breaker.getMetrics().successCount).toBe(1);
      breaker.destroy();
    });
  });

  describe('reset', () => {
    it('resets failure count, success count, timeout count and transitions to CLOSED', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('boom'));
      for (let i = 0; i < 2; i++) {
        await expect(cb.execute(failingFn)).rejects.toThrow();
      }
      expect(cb.failureCount).toBe(2);
      cb.reset();
      expect(cb.state).toBe(CircuitState.CLOSED);
      expect(cb.failureCount).toBe(0);
      expect(cb.successCount).toBe(0);
      expect(cb.timeoutCount).toBe(0);
    });
  });
});