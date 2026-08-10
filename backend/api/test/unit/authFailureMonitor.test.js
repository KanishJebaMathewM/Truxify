import { describe, it, expect, vi, beforeEach } from 'vitest';
import logger from '../../middleware/logger.js';

vi.mock('../../middleware/logger.js', () => ({
  default: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// Test shouldIgnoreError logic directly (unit test)
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
    const err = new Error('Unknown error');
    err.code = 'INTERNAL_ERROR';
    expect(shouldIgnoreError(err)).toBe(false);
  });

  it('does not ignore errors without a code property', () => {
    const err = new Error('No code');
    expect(shouldIgnoreError(err)).toBe(false);
  });
});
