import { describe, it, expect } from 'vitest';

function shouldIgnoreError(err) {
  const filters = [
    { code: 'ECONNRESET', level: 'warn' },
    { code: 'ECONNREFUSED', level: 'warn' },
    { code: 'ETIMEDOUT', level: 'warn' },
  ];
  return filters.some((f) => err.code === f.code);
}

describe('shouldIgnoreError', () => {
  it('ignores ECONNRESET errors', () => {
    const err = new Error('Connection reset');
    err.code = 'ECONNRESET';
    expect(shouldIgnoreError(err)).toBe(true);
  });

  it('ignores ECONNREFUSED errors', () => {
    const err = new Error('Connection refused');
    err.code = 'ECONNREFUSED';
    expect(shouldIgnoreError(err)).toBe(true);
  });

  it('ignores ETIMEDOUT errors', () => {
    const err = new Error('Connection timed out');
    err.code = 'ETIMEDOUT';
    expect(shouldIgnoreError(err)).toBe(true);
  });

  it('does not ignore other error codes', () => {
    const err = new Error('Something went wrong');
    err.code = 'INTERNAL_ERROR';
    expect(shouldIgnoreError(err)).toBe(false);
  });

  it('does not ignore errors without a code', () => {
    const err = new Error('No code property');
    expect(shouldIgnoreError(err)).toBe(false);
  });
});
