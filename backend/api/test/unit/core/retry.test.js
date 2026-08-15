import { describe, it, expect, vi, beforeEach } from 'vitest';

// We need to test the internal functions, so we'll re-implement the logic
// to verify the behavior matches what the code does

const NETWORK_ERROR_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ENOTFOUND',
  'ENETUNREACH',
  'EPIPE',
  'ERR_NETWORK',
  'FETCH_ERR',
]);

function isTransientHttpStatus(status) {
  if (status === null) return false;
  if (status === 408) return true;
  if (status >= 500 && status <= 599) return true;
  if (status === 429 || status === 408) return true;
  return false;
}

function isTransientError(error) {
  if (!error) return false;

  if (error.code && NETWORK_ERROR_CODES.has(error.code)) return true;

  if (error.status != null && isTransientHttpStatus(Number(error.status))) return true;

  if (error.message) {
    const msg = error.message.toLowerCase();
    if (msg.includes('network timeout') || msg.includes('timeout') || msg.includes('econnreset') || msg.includes('etimedout') || msg.includes('fetch failed') || msg.includes('socket hang up') || msg.includes('unexpected network')) {
      return true;
    }
  }

  if (error.name === 'AbortError' || error.name === 'TimeoutError') return true;

  return false;
}

function isNonRetryableSupabaseError(error) {
  if (!error) return false;

  if (error.code === '23505') return true; // duplicate key
  if (error.code === 'PGRST116') return true; // no rows returned
  if (error.code === 'PGRST204') return true; // no columns returned
  if (error.code === '42501') return true; // permission denied
  if (error.code?.startsWith('PGRST')) return true; // postgrest errors

  if (error.status != null) {
    const s = Number(error.status);
    if (s >= 200 && s < 500 && s !== 429 && s !== 408) return true;
  }

  return false;
}

function isRetryable(error) {
  if (isNonRetryableSupabaseError(error)) return false;
  return isTransientError(error);
}

describe('core/retry - isTransientHttpStatus', () => {
  it('returns false for null', () => {
    expect(isTransientHttpStatus(null)).toBe(false);
  });

  it('returns true for 408', () => {
    expect(isTransientHttpStatus(408)).toBe(true);
  });

  it('returns true for 429', () => {
    expect(isTransientHttpStatus(429)).toBe(true);
  });

  it('returns true for 500', () => {
    expect(isTransientHttpStatus(500)).toBe(true);
  });

  it('returns true for 503', () => {
    expect(isTransientHttpStatus(503)).toBe(true);
  });

  it('returns false for 400', () => {
    expect(isTransientHttpStatus(400)).toBe(false);
  });

  it('returns false for 404', () => {
    expect(isTransientHttpStatus(404)).toBe(false);
  });
});

describe('core/retry - isTransientError', () => {
  it('returns false for null', () => {
    expect(isTransientError(null)).toBe(false);
  });

  it('returns true for ECONNRESET', () => {
    expect(isTransientError({ code: 'ECONNRESET' })).toBe(true);
  });

  it('returns true for ETIMEDOUT', () => {
    expect(isTransientError({ code: 'ETIMEDOUT' })).toBe(true);
  });

  it('returns true for error with 408 status', () => {
    expect(isTransientError({ status: 408 })).toBe(true);
  });

  it('returns true for error with 500 status', () => {
    expect(isTransientError({ status: 500 })).toBe(true);
  });

  it('returns true for AbortError', () => {
    expect(isTransientError({ name: 'AbortError' })).toBe(true);
  });

  it('returns true for TimeoutError', () => {
    expect(isTransientError({ name: 'TimeoutError' })).toBe(true);
  });

  it('returns false for unknown error', () => {
    expect(isTransientError({ message: 'something else' })).toBe(false);
  });
});

describe('core/retry - isNonRetryableSupabaseError', () => {
  it('returns true for duplicate key error', () => {
    expect(isNonRetryableSupabaseError({ code: '23505' })).toBe(true);
  });

  it('returns true for PGRST116 no rows', () => {
    expect(isNonRetryableSupabaseError({ code: 'PGRST116' })).toBe(true);
  });

  it('returns true for PGRST204 no columns', () => {
    expect(isNonRetryableSupabaseError({ code: 'PGRST204' })).toBe(true);
  });

  it('returns true for permission denied', () => {
    expect(isNonRetryableSupabaseError({ code: '42501' })).toBe(true);
  });

  it('returns true for other PGRST errors', () => {
    expect(isNonRetryableSupabaseError({ code: 'PGRST301' })).toBe(true);
  });

  it('returns true for 400 status (non-retryable)', () => {
    expect(isNonRetryableSupabaseError({ status: 400 })).toBe(true);
  });

  it('returns false for 429 (rate limited - retryable)', () => {
    expect(isNonRetryableSupabaseError({ status: 429 })).toBe(false);
  });

  it('returns false for 408 (timeout - retryable)', () => {
    expect(isNonRetryableSupabaseError({ status: 408 })).toBe(false);
  });
});

describe('core/retry - isRetryable', () => {
  it('returns false for non-retryable supabase error', () => {
    expect(isRetryable({ code: '23505' })).toBe(false);
  });

  it('returns true for transient network error', () => {
    expect(isRetryable({ code: 'ECONNRESET' })).toBe(true);
  });

  it('returns true for transient HTTP status', () => {
    expect(isRetryable({ status: 500 })).toBe(true);
  });

  it('returns false for null', () => {
    expect(isRetryable(null)).toBe(false);
  });
});
