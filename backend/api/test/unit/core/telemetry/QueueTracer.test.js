import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSpan = {
  recordException: vi.fn(),
  setStatus: vi.fn(),
  setAttributes: vi.fn(),
  addEvent: vi.fn(),
  end: vi.fn(),
  spanContext: () => ({ traceId: 'trace-1' }),
};

vi.mock('../../../../src/core/telemetry/SpanFactory.js', () => ({
  default: {
    withQueueProduceSpan: vi.fn(async (topic, fn, options) => fn()),
    withSpan: vi.fn(async (name, fn, options) => fn()),
    startSpan: vi.fn(() => mockSpan),
    recordError: vi.fn(),
  },
  STANDARD_ATTRIBUTES: {
    KAFKA_TOPIC: 'kafka.topic',
    KAFKA_PARTITION: 'kafka.partition',
    KAFKA_OFFSET: 'kafka.offset',
    KAFKA_CONSUMER_GROUP: 'kafka.consumer_group',
  },
}));

vi.mock('../../../../src/core/telemetry/ContextPropagator.js', () => ({
  ContextPropagator: {
    injectIntoKafkaMessage: (msg) => ({ ...msg, injected: true }),
    extractFromKafkaHeaders: () => ({}),
  },
}));

const { QueueTracer } = await import('../../../../src/core/telemetry/QueueTracer.js');
const spanFactoryMock = (await import('../../../../src/core/telemetry/SpanFactory.js')).default;

describe('QueueTracer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('wrapProducer traces produce and injects context', async () => {
    const produceFn = vi.fn().mockResolvedValue('produced');
    const wrapped = QueueTracer.wrapProducer(produceFn, 'orders');

    const result = await wrapped({ value: 'x' });

    expect(result).toBe('produced');
    expect(produceFn).toHaveBeenCalledWith(
      expect.objectContaining({ value: 'x', injected: true }),
    );
    expect(spanFactoryMock.withQueueProduceSpan).toHaveBeenCalled();
  });

  it('wrapConsumer traces consume and ends the span', async () => {
    const handler = vi.fn().mockResolvedValue('handled');
    const wrapped = QueueTracer.wrapConsumer(handler, { consumerGroup: 'cg-1' });

    const result = await wrapped('orders', { headers: {} }, { partition: 1, offset: '5' });

    expect(result).toBe('handled');
    expect(spanFactoryMock.startSpan).toHaveBeenCalledWith(
      'kafka.consume',
      expect.objectContaining({
        attributes: expect.objectContaining({ 'kafka.partition': 1, 'kafka.offset': '5' }),
      }),
    );
    expect(mockSpan.end).toHaveBeenCalled();
  });

  it('wrapConsumer records errors and rethrows', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('consume failed'));
    const wrapped = QueueTracer.wrapConsumer(handler);

    await expect(wrapped('orders', {}, {})).rejects.toThrow('consume failed');
    expect(spanFactoryMock.recordError).toHaveBeenCalled();
  });

  it('wrapConsumerHandler processes with a span', async () => {
    const handler = vi.fn().mockResolvedValue('ok');
    const wrapped = QueueTracer.wrapConsumerHandler('orders', handler, { consumerGroup: 'cg-2' });

    const result = await wrapped({ headers: {} }, {});
    expect(result).toBe('ok');
    expect(spanFactoryMock.withSpan).toHaveBeenCalled();
  });

  it('createProducerTracer returns a trace helper', async () => {
    const tracer = QueueTracer.createProducerTracer('orders');
    const result = await tracer.trace(async () => 'value');
    expect(result).toBe('value');
  });

  it('createConsumerTracer returns a trace helper that runs the fn', async () => {
    const tracer = QueueTracer.createConsumerTracer('orders', 'cg-3');
    const result = await tracer.trace({ headers: {} }, { partition: 0 }, async () => 'ran');
    expect(result).toBe('ran');
  });
});
