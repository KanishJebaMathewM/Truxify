import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSpan = {
  recordException: vi.fn(),
  setStatus: vi.fn(),
  setAttributes: vi.fn(),
  addEvent: vi.fn(),
  end: vi.fn(),
  spanContext: () => ({ traceId: 'trace-1' }),
};

const mockTracer = {
  startSpan: vi.fn(() => mockSpan),
};

vi.mock('../../../../src/tracing/tracing.js', () => ({
  default: {
    getTracer: () => mockTracer,
  },
}));

const { default: spanFactory, SPAN_NAMES, STANDARD_ATTRIBUTES } = await import(
  '../../../../src/core/telemetry/SpanFactory.js'
);

describe('SpanFactory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('startSpan starts a span with the service name attribute', () => {
    const span = spanFactory.startSpan('test.op');
    expect(mockTracer.startSpan).toHaveBeenCalledWith(
      'test.op',
      expect.objectContaining({
        attributes: expect.objectContaining({ 'service.name': 'truxify-api' }),
      }),
      expect.anything(),
    );
    expect(span).toBe(mockSpan);
  });

  it('startWorkerSpan adds worker attributes', () => {
    spanFactory.startWorkerSpan('my-worker', { attempt: 2, maxAttempts: 3 });
    const [, options] = mockTracer.startSpan.mock.calls[0];
    expect(options.attributes['worker.name']).toBe('my-worker');
    expect(options.attributes['worker.attempt']).toBe(2);
    expect(options.attributes['worker.max_attempts']).toBe(3);
  });

  it('startEventPublishSpan adds event attributes', () => {
    spanFactory.startEventPublishSpan('order.created', { source: 'order-service', eventId: 'evt-1' });
    const [, options] = mockTracer.startSpan.mock.calls[0];
    expect(options.attributes['event.type']).toBe('order.created');
    expect(options.attributes['event.source']).toBe('order-service');
    expect(options.attributes['event.id']).toBe('evt-1');
  });

  it('startQueueConsumeSpan adds kafka attributes', () => {
    spanFactory.startQueueConsumeSpan('orders', {
      partition: 2,
      offset: '100',
      consumerGroup: 'cg-1',
    });
    const [, options] = mockTracer.startSpan.mock.calls[0];
    expect(options.attributes['queue.name']).toBe('orders');
    expect(options.attributes['kafka.partition']).toBe(2);
    expect(options.attributes['kafka.offset']).toBe('100');
    expect(options.attributes['kafka.consumer_group']).toBe('cg-1');
  });

  it('recordError sets error status and attributes', () => {
    const error = new Error('boom');
    error.name = 'CustomError';
    spanFactory.recordError(mockSpan, error);
    expect(mockSpan.recordException).toHaveBeenCalledWith(error);
    expect(mockSpan.setStatus).toHaveBeenCalledWith(
      expect.objectContaining({ code: 2, message: 'boom' }),
    );
    expect(mockSpan.setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({ 'error.type': 'CustomError' }),
    );
  });

  it('recordError tolerates a null span', () => {
    expect(() => spanFactory.recordError(null, new Error('x'))).not.toThrow();
  });

  it('endSpan sets duration and ends', () => {
    spanFactory.endSpan(mockSpan, 42);
    expect(mockSpan.setAttributes).toHaveBeenCalledWith({ 'duration.ms': 42 });
    expect(mockSpan.end).toHaveBeenCalled();
  });

  it('endSpan tolerates a null span', () => {
    expect(() => spanFactory.endSpan(null, 1)).not.toThrow();
  });

  it('withSpan ends the span on success', async () => {
    const result = await spanFactory.withSpan('op', async () => 'ok');
    expect(result).toBe('ok');
    expect(mockSpan.end).toHaveBeenCalled();
  });

  it('withSpan records and rethrows errors', async () => {
    await expect(
      spanFactory.withSpan('op', async () => {
        throw new Error('fail');
      }),
    ).rejects.toThrow('fail');
    expect(mockSpan.recordException).toHaveBeenCalled();
  });

  it('exposes span name constants', () => {
    expect(SPAN_NAMES.WORKER_EXECUTION).toBe('worker.execution');
    expect(STANDARD_ATTRIBUTES.SERVICE_NAME).toBe('service.name');
  });
});
