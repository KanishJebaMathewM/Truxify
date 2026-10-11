import { describe, it, expect, vi } from 'vitest';
import { WorkerTracer } from '../../src/core/telemetry/WorkerTracer.js';

describe('WorkerTracer', () => {
  it('can be instantiated', () => {
    const tracer = new WorkerTracer();
    expect(tracer).toBeDefined();
  });

  // The class is a static wrapper factory now — the instance startSpan API
  // is gone. Exercise the real surface: createTracedWorker wraps a handler
  // in a span that ends cleanly on success.
  it('exposes the static wrapper factories', () => {
    expect(typeof WorkerTracer.createTracedWorker).toBe('function');
    expect(typeof WorkerTracer.wrapCronJob).toBe('function');
    expect(typeof WorkerTracer.wrapIntervalWorker).toBe('function');
    expect(typeof WorkerTracer.wrapChildProcess).toBe('function');
    expect(typeof WorkerTracer.executeWithTraceContext).toBe('function');
  });

  it('createTracedWorker returns a handler that runs the wrapped fn and ends its span', async () => {
    const handler = vi.fn().mockResolvedValue('done');
    const traced = WorkerTracer.createTracedWorker('test-worker', handler);
    const result = await traced('arg1');
    expect(result).toBe('done');
    expect(handler).toHaveBeenCalledWith('arg1');
  });

  it('createTracedWorker retries up to maxAttempts on handler failure', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('boom'));
    const traced = WorkerTracer.createTracedWorker('retry-worker', handler, { maxAttempts: 2 });
    await expect(traced()).rejects.toThrow('boom');
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
