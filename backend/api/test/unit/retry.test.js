import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { executeWithRetry, isRetryable } = await import('../../src/core/retry.js');

const logger = (await import('../../src/middleware/logger.js')).default;

describe('isRetryable', () => {
  it('returns true for network error codes', () => {
    expect(isRetryable({ code: 'ECONNRESET' })).toBe(true);
    expect(isRetryable({ code: 'ETIMEDOUT' })).toBe(true);
    expect(isRetryable({ code: 'ECONNREFUSED' })).toBe(true);
    expect(isRetryable({ code: 'ENETUNREACH' })).toBe(true);
  });

  it('returns true for HTTP 429', () => {
    expect(isRetryable({ status: 429 })).toBe(true);
  });

  it('returns true for HTTP 5xx', () => {
    expect(isRetryable({ status: 500 })).toBe(true);
    expect(isRetryable({ status: 502 })).toBe(true);
    expect(isRetryable({ status: 503 })).toBe(true);
  });

  it('returns false for HTTP 4xx (except 429)', () => {
    expect(isRetryable({ status: 400 })).toBe(false);
    expect(isRetryable({ status: 401 })).toBe(false);
    expect(isRetryable({ status: 403 })).toBe(false);
    expect(isRetryable({ status: 404 })).toBe(false);
    expect(isRetryable({ status: 422 })).toBe(false);
  });

  it('returns false for 2xx/3xx', () => {
    expect(isRetryable({ status: 200 })).toBe(false);
    expect(isRetryable({ status: 204 })).toBe(false);
    expect(isRetryable({ status: 301 })).toBe(false);
  });

  it('returns false for non-retryable Supabase error codes', () => {
    expect(isRetryable({ code: '23505' })).toBe(false);       // duplicate key
    expect(isRetryable({ code: '42501' })).toBe(false);       // permission denied
    expect(isRetryable({ code: 'PGRST116' })).toBe(false);    // no rows
    expect(isRetryable({ code: 'PGRST204' })).toBe(false);    // no columns
    expect(isRetryable({ code: 'PGRST300' })).toBe(false);    // general postgrest
  });

  it('returns true for timeout messages', () => {
    expect(isRetryable({ message: 'network timeout' })).toBe(true);
    expect(isRetryable({ message: 'timeout exceeded' })).toBe(true);
    expect(isRetryable({ message: 'fetch failed' })).toBe(true);
    expect(isRetryable({ message: 'socket hang up' })).toBe(true);
  });

  it('returns true for AbortError / TimeoutError', () => {
    expect(isRetryable({ name: 'AbortError' })).toBe(true);
    expect(isRetryable({ name: 'TimeoutError' })).toBe(true);
  });

  it('returns false for null/undefined', () => {
    expect(isRetryable(null)).toBe(false);
    expect(isRetryable(undefined)).toBe(false);
  });
});

describe('executeWithRetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves on first attempt', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await executeWithRetry(fn, { operation: 'test' });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on transient error and succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce({ code: 'ECONNRESET', message: 'connection reset' })
      .mockResolvedValueOnce('ok');

    const result = await executeWithRetry(fn, { operation: 'test', maxRetries: 2 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries up to maxRetries and throws', async () => {
    const err = { code: 'ECONNRESET', message: 'connection reset' };
    const fn = vi.fn().mockRejectedValue(err);

    await expect(executeWithRetry(fn, { operation: 'test', maxRetries: 2 })).rejects.toEqual(err);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry non-retryable errors', async () => {
    const err = { code: '23505', message: 'duplicate key' };
    const fn = vi.fn().mockRejectedValue(err);

    await expect(executeWithRetry(fn, { operation: 'test' })).rejects.toEqual(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not retry HTTP 4xx errors', async () => {
    const err = { status: 404, message: 'not found' };
    const fn = vi.fn().mockRejectedValue(err);

    await expect(executeWithRetry(fn, { operation: 'test' })).rejects.toEqual(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('uses exponential backoff delay', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce({ code: 'ECONNRESET' })
      .mockRejectedValueOnce({ code: 'ECONNRESET' })
      .mockResolvedValueOnce('ok');

    const start = Date.now();
    await executeWithRetry(fn, { operation: 'test', maxRetries: 3, baseDelayMs: 50, maxDelayMs: 10000 });
    const elapsed = Date.now() - start;

    // attempt 1: immediate, attempt 2: ~50ms, attempt 3: ~100ms => total ~150ms
    expect(elapsed).toBeGreaterThanOrEqual(140);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('caps delay at maxDelayMs', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce({ code: 'ECONNRESET' })
      .mockRejectedValueOnce({ code: 'ECONNRESET' })
      .mockRejectedValueOnce({ code: 'ECONNRESET' })
      .mockResolvedValueOnce('ok');

    const start = Date.now();
    await executeWithRetry(fn, { operation: 'test', maxRetries: 3, baseDelayMs: 100, maxDelayMs: 150 });
    const elapsed = Date.now() - start;

    // attempts: 1(0), 2(100), 3(150 capped), 4(150 capped) => ~400ms
    expect(elapsed).toBeGreaterThanOrEqual(350);
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('logs warning on retry', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce({ code: 'ECONNRESET', message: 'reset' })
      .mockResolvedValueOnce('ok');

    await executeWithRetry(fn, { operation: 'test_query', maxRetries: 2 });

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const callArgs = logger.warn.mock.calls[0];
    expect(callArgs[0]).toMatchObject({ operation: 'test_query', attempt: 1, maxRetries: 2 });
    expect(callArgs[1]).toContain('test_query');
  });

  it('logs warning on final non-retryable error after retries', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce({ code: 'ECONNRESET' })
      .mockRejectedValueOnce({ code: '23505' });

    await expect(executeWithRetry(fn, { operation: 'test', maxRetries: 2 })).rejects.toEqual({ code: '23505' });

    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn.mock.calls[1][1]).toContain('Non-retryable');
  });

  it('uses defaults when no options are passed', async () => {
    const fn = vi.fn().mockResolvedValue('defaults');
    const result = await executeWithRetry(fn);
    expect(result).toBe('defaults');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on Supabase-style returned error object (not thrown)', async () => {
    let callCount = 0;
    const fn = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        throw { status: 503, message: 'service unavailable', code: 'HTTP_503' };
      }
      return { data: 'recovered', error: null };
    });

    const result = await executeWithRetry(fn, { operation: 'test', maxRetries: 2 });
    expect(result).toEqual({ data: 'recovered', error: null });
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
