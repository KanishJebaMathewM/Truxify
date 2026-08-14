import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CircuitBreaker, CircuitState } from '../../src/lib/circuitBreaker.js';

describe('CircuitBreaker', () => {
  let cb;

  beforeEach(() => {
    cb = new CircuitBreaker('test', { failureThreshold: 3, resetTimeoutMs: 1000 });
  });

  afterEach(() => {
    cb.destroy();
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('initializes with default options', () => {
      const defaultCb = new CircuitBreaker('default');
      expect(defaultCb.name).toBe('default');
      expect(defaultCb.failureThreshold).toBe(5);
      expect(defaultCb.resetTimeoutMs).toBe(30000);
      expect(defaultCb.requestTimeoutMs).toBe(5000);
      expect(defaultCb.state).toBe(CircuitState.CLOSED);
      defaultCb.destroy();
    });

    it('accepts custom options', () => {
      const customCb = new CircuitBreaker('custom', {
        failureThreshold: 2,
        resetTimeoutMs: 5000,
        requestTimeoutMs: 2000,
      });
      expect(customCb.failureThreshold).toBe(2);
      expect(customCb.resetTimeoutMs).toBe(5000);
      expect(customCb.requestTimeoutMs).toBe(2000);
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
  });

  describe('execute', () => {
    it('executes a successful function and returns result', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      const result = await cb.execute(fn, 'arg1');
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledWith('arg1');
    });

    it('throws TypeError when fn is not a function', async () => {
      await expect(cb.execute('not a function')).rejects.toThrow('fn must be a function');
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
      // After 2 failures the circuit opens. Subsequent calls return fallback without
      // calling the wrapped function.
      const result1 = await cbWithFallback.execute(failingFn);
      expect(result1).toBe('fallback result');
      expect(failingFn).toHaveBeenCalledTimes(1); // first call fails normally
      const result2 = await cbWithFallback.execute(failingFn);
      expect(result2).toBe('fallback result');
      expect(failingFn).toHaveBeenCalledTimes(2); // second call fails and opens circuit
      const result3 = await cbWithFallback.execute(vi.fn());
      expect(result3).toBe('fallback result'); // circuit OPEN — fallback used, no fn call
      expect(cbWithFallback.state).toBe(CircuitState.OPEN);
      cbWithFallback.destroy();
    });
  });

  describe('reset', () => {
    it('resets failure count and transitions to CLOSED', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('boom'));
      for (let i = 0; i < 2; i++) {
        await expect(cb.execute(failingFn)).rejects.toThrow();
      }
      expect(cb.failureCount).toBe(2);
      cb.reset();
      expect(cb.state).toBe(CircuitState.CLOSED);
      expect(cb.failureCount).toBe(0);
    });
  });
});
