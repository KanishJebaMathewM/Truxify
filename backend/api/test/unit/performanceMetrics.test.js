import { describe, it, expect, vi, beforeEach } from 'vitest';
import { measureExecution } from '../../src/core/performanceMetrics.js';

describe('measureExecution', () => {
  beforeEach(() => {
    delete process.env.SLOW_OPERATION_THRESHOLD_MS;
  });

  it('returns the result of the async function', async () => {
    const result = await measureExecution('test.op', async () => 'hello');
    expect(result).toBe('hello');
  });

  it('re-throws errors from the async function', async () => {
    await expect(measureExecution('test.op', async () => {
      throw new Error('boom');
    })).rejects.toThrow('boom');
  });

  it('measures fast operations without warning', async () => {
    const result = await measureExecution('test.op', async () => 42);
    expect(result).toBe(42);
  });

  it('supports non-async functions that return promises', async () => {
    const result = await measureExecution('test.op', () => Promise.resolve(99));
    expect(result).toBe(99);
  });
});
