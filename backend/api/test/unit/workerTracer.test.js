import { describe, it, expect, vi } from 'vitest';
import { WorkerTracer } from '../../src/core/telemetry/WorkerTracer.js';

describe('WorkerTracer', () => {
  it('can be instantiated', () => {
    const tracer = new WorkerTracer();
    expect(tracer).toBeDefined();
  });

  // The real surface is static wrappers around @opentelemetry spans —
  // there is no instance startSpan API.
  it('exposes the static worker-wrapping API', () => {
    expect(typeof WorkerTracer.createTracedWorker).toBe('function');
    expect(typeof WorkerTracer.wrapCronJob).toBe('function');
    expect(typeof WorkerTracer.wrapIntervalWorker).toBe('function');
    expect(typeof WorkerTracer.wrapChildProcess).toBe('function');
    expect(typeof WorkerTracer.executeWithTraceContext).toBe('function');
  });

  it('createTracedWorker returns a handler that invokes the wrapped fn', async () => {
    const handler = vi.fn().mockResolvedValue('ok');
    const traced = WorkerTracer.createTracedWorker('test-worker', handler);
    expect(typeof traced).toBe('function');
    await expect(traced('arg-1')).resolves.toBe('ok');
    expect(handler).toHaveBeenCalledWith('arg-1');
  });
});
