import { describe, it, expect, vi } from 'vitest';
import { WorkerTracer } from '../../../../src/core/telemetry/WorkerTracer.js';

describe('WorkerTracer', () => {
  it('can be instantiated', () => {
    const tracer = new WorkerTracer();
    expect(tracer).toBeDefined();
  });

  it('has startSpan method', () => {
    const tracer = new WorkerTracer();
    expect(typeof tracer.startSpan).toBe('function');
  });

  it('startSpan returns a span object', () => {
    const tracer = new WorkerTracer();
    const span = tracer.startSpan('test-span', { workerId: 'w1' });
    expect(span).toBeDefined();
    expect(span.end).toBeDefined();
  });

  it('span can be ended', () => {
    const tracer = new WorkerTracer();
    const span = tracer.startSpan('test-span');
    span.end();
    expect(span.endTime).toBeDefined();
  });
});
