import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

import { measureExecution } from '../../../src/core/performanceMetrics.js';

describe('measureExecution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the result of the async function', async () => {
    const result = await measureExecution('test-op', async () => 'expected');
    expect(result).toBe('expected');
  });

  it('does not warn when operation is fast', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00'));

    const fastFn = vi.fn().mockResolvedValue('fast');
    await measureExecution('fast-op', fastFn);

    expect(mockLogger.warn).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('re-throws errors from the async function', async () => {
    const err = new Error('function failed');
    await expect(measureExecution('failing-op', async () => { throw err; })).rejects.toThrow('function failed');
  });
});
