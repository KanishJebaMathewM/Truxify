import { describe, it, expect, vi } from 'vitest';

const spanFactoryMocks = vi.hoisted(() => {
  const makeSpan = () => ({
    setAttribute: vi.fn(),
    setStatus: vi.fn(),
    end: vi.fn(),
    recordException: vi.fn(),
  });
  return {
    startWorkerSpan: vi.fn(() => makeSpan()),
    startRetrySpan: vi.fn(() => makeSpan()),
    recordError: vi.fn(),
    withWorkerSpan: vi.fn(),
  };
});

vi.mock('../../src/core/telemetry/SpanFactory.js', () => ({
  default: spanFactoryMocks,
  STANDARD_ATTRIBUTES: {
    WORKER_ATTEMPT: 'worker.attempt',
    WORKER_MAX_ATTEMPTS: 'worker.max_attempts',
  },
}));

import { WorkerTracer } from '../../src/core/telemetry/WorkerTracer.js';

describe('WorkerTracer', () => {
  it('createTracedWorker returns a callable function', () => {
    const traced = WorkerTracer.createTracedWorker('test-worker', () => 1);
    expect(typeof traced).toBe('function');
  });

  it('invokes the handler and returns its result', async () => {
    const handler = vi.fn(async () => 'done');
    const traced = WorkerTracer.createTracedWorker('test-worker', handler);
    await expect(traced()).resolves.toBe('done');
    expect(handler).toHaveBeenCalledOnce();
  });

  it('retries the handler within maxAttempts', async () => {
    const handler = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('ok');
    const traced = WorkerTracer.createTracedWorker('retry-worker', handler, {
      maxAttempts: 2,
      retryDelayMs: 0,
    });
    await expect(traced()).resolves.toBe('ok');
    expect(handler).toHaveBeenCalledTimes(2);
  });
});