import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

describe('retry utility', () => {
  it('exports isRetryable function', async () => {
    const { isRetryable } = await import('../../src/core/retry.js');
    expect(typeof isRetryable).toBe('function');
  });

  it('isRetryable returns boolean for Error', async () => {
    const { isRetryable } = await import('../../src/core/retry.js');
    expect(typeof isRetryable(new Error('test'))).toBe('boolean');
  });

  it('exports executeWithRetry function', async () => {
    const { executeWithRetry } = await import('../../src/core/retry.js');
    expect(typeof executeWithRetry).toBe('function');
  });
});
