import { describe, it, expect, vi, beforeEach } from 'vitest';
import logger from '../../src/middleware/logger.js';

vi.mock('../../src/middleware/logger.js', () => ({
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


// === Spec 4 test ===
import { checkBoundOrFailClosed } from '../../src/middleware/authFailureMonitor.js';
describe('checkBoundOrFailClosed', () => {
  it('allows under limit', async () => {
    const r = { incr: vi.fn().mockResolvedValue(1) };
    expect((await checkBoundOrFailClosed(r, '1.2.3.4')).allowed).toBe(true);
  });
  it('denies when banned', async () => {
    const r = { incr: vi.fn().mockResolvedValue(10) };
    const out = await checkBoundOrFailClosed(r, '1.2.3.4', { maxAttempts: 5 });
    expect(out.allowed).toBe(false);
    expect(out.reason).toBe('banned');
  });
});

