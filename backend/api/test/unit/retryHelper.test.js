import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/core/telemetry/SpanFactory.js', () => ({
  default: { startRetrySpan: vi.fn(() => ({ end: vi.fn() })) },
}));

vi.mock('../../src/core/telemetry/ContextPropagator.js', () => ({
  ContextPropagator: {
    snapshot: vi.fn(() => ({})),
    restore: vi.fn(async (_snap, fn) => fn()),
  },
}));

import { isRetryable, executeWithRetry } from '../../src/core/retry.js';

describe('retry helpers', () => {
  describe('isRetryable', () => {
    it('returns false for non-retryable Supabase codes', () => {
      expect(isRetryable({ code: '23505' })).toBe(false);
      expect(isRetryable({ code: 'PGRST116' })).toBe(false);
      expect(isRetryable({ code: '42501' })).toBe(false);
    });

    it('returns true for network error codes', () => {
      expect(isRetryable({ code: 'ECONNRESET' })).toBe(true);
      expect(isRetryable({ code: 'ETIMEDOUT' })).toBe(true);
      expect(isRetryable({ code: 'ENOTFOUND' })).toBe(true);
    });

    it('returns true for transient HTTP statuses', () => {
      expect(isRetryable({ status: 429 })).toBe(true);
      expect(isRetryable({ status: 503 })).toBe(true);
      expect(isRetryable({ status: 408 })).toBe(true);
    });

    it('returns false for client errors', () => {
      expect(isRetryable({ status: 400 })).toBe(false);
      expect(isRetryable({ status: 401 })).toBe(false);
    });

    it('returns false for falsy errors', () => {
      expect(isRetryable(null)).toBe(false);
      expect(isRetryable(undefined)).toBe(false);
    });
  });

  describe('executeWithRetry', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns the result on first success', async () => {
      const fn = vi.fn().mockResolvedValue('ok');
      const result = await executeWithRetry(fn, { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 10 });
      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries transient errors and succeeds', async () => {
      vi.useFakeTimers();
      const fn = vi.fn()
        .mockRejectedValueOnce({ code: 'ECONNRESET' })
        .mockResolvedValueOnce('recovered');
      const promise = executeWithRetry(fn, { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 10 });
      await vi.advanceTimersByTimeAsync(50);
      await expect(promise).resolves.toBe('recovered');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('throws after max retries', async () => {
      vi.useFakeTimers();
      const error = { code: 'ECONNRESET' };
      const fn = vi.fn().mockRejectedValue(error);
      const promise = executeWithRetry(fn, { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 10 });
      await vi.advanceTimersByTimeAsync(200);
      await expect(promise).rejects.toBe(error);
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('does not retry non-retryable errors', async () => {
      const error = { code: '23505' };
      const fn = vi.fn().mockRejectedValue(error);
      await expect(executeWithRetry(fn, { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 10 })).rejects.toBe(error);
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });
});
