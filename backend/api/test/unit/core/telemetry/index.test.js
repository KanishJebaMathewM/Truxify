import { describe, it, expect, vi } from 'vitest';
import {
  TraceContext,
  ContextPropagator,
  WorkerTracer,
  QueueTracer,
  EventTracer,
  SpanFactory,
  SPAN_NAMES,
  STANDARD_ATTRIBUTES,
  enhancedTracingMiddleware,
  createWorkerContextFromRequest,
  propagateContextToBackground,
  restoreBackgroundContext,
  default as spanFactory,
} from '../../../../src/core/telemetry/index.js';

vi.mock('../../../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('core/telemetry barrel exports', () => {
  it('exports the trace context classes', () => {
    expect(typeof TraceContext.injectIntoHeaders).toBe('function');
    expect(typeof TraceContext.extractFromHeaders).toBe('function');
    expect(typeof ContextPropagator.snapshot).toBe('function');
    expect(typeof ContextPropagator.injectIntoEventPayload).toBe('function');
  });

  it('exports the tracer classes', () => {
    expect(typeof WorkerTracer.createTracedWorker).toBe('function');
    expect(typeof QueueTracer.wrapProducer).toBe('function');
    expect(typeof EventTracer.traceEventBus).toBe('function');
    expect(typeof SpanFactory.prototype.startSpan).toBe('function');
  });

  it('exports the span name and attribute constants', () => {
    expect(SPAN_NAMES.WORKER_EXECUTION).toBe('worker.execution');
    expect(SPAN_NAMES.KAFKA_CONSUME).toBe('kafka.consume');
    expect(STANDARD_ATTRIBUTES.WORKER_NAME).toBe('worker.name');
    expect(STANDARD_ATTRIBUTES.CORRELATION_ID).toBe('correlation.id');
  });

  it('exports the trace middleware helpers as functions', () => {
    expect(typeof enhancedTracingMiddleware).toBe('function');
    expect(typeof createWorkerContextFromRequest).toBe('function');
    expect(typeof propagateContextToBackground).toBe('function');
    expect(typeof restoreBackgroundContext).toBe('function');
  });

  it('defaults to the spanFactory instance', () => {
    expect(spanFactory).toBeDefined();
    expect(typeof spanFactory.startSpan).toBe('function');
    expect(typeof spanFactory.withSpan).toBe('function');
  });
});
