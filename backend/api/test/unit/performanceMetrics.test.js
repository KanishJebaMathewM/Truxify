import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('performanceMetrics', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
  });

  it('exports measureExecution function', async () => {
    const mod = await import('../../src/core/performanceMetrics.js');
    expect(typeof mod.measureExecution).toBe('function');
  });

  it('measureExecution returns the function result', async () => {
    const { measureExecution } = await import('../../src/core/performanceMetrics.js');
    const result = await measureExecution('test-op', async () => 'success');
    expect(result).toBe('success');
  });

  it('measureExecution propagates errors', async () => {
    const { measureExecution } = await import('../../src/core/performanceMetrics.js');
    await expect(
      measureExecution('failing-op', async () => { throw new Error('fail'); })
    ).rejects.toThrow('fail');
  });
});
