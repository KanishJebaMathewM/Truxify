/**
 * Unit tests for backend/api/src/core/telemetry/QueueTracer.js
 *
 * QueueTracer is a static helper (no constructor/traceEnqueue/traceDequeue/traceAck API):
 *   - wrapProducer: produce span + trace context injected into the message
 *   - wrapConsumer: kafka.consume span with partition/offset/group, OK or error status
 *   - wrapConsumerHandler: kafka.process.<topic> span
 *   - createProducerTracer / createConsumerTracer: small span wrappers
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const makeSpan = () => ({ setStatus: vi.fn(), end: vi.fn(), setAttributes: vi.fn(), setAttribute: vi.fn() });

const { spanFactoryMock, propagatorMock } = vi.hoisted(() => ({
  spanFactoryMock: {
    startSpan: vi.fn(),
    recordError: vi.fn(),
    withSpan: vi.fn(async (_name, fn) => fn()),
    withQueueProduceSpan: vi.fn(async (_topic, fn) => fn()),
  },
  propagatorMock: {
    injectIntoKafkaMessage: vi.fn((message) => ({ ...message, headers: { traceparent: 'tp' } })),
    extractFromKafkaHeaders: vi.fn(() => ({ parent: 'ctx' })),
  },
}));

vi.mock('@opentelemetry/api', () => ({
  context: { active: vi.fn(() => ({})), with: vi.fn((_ctx, fn) => fn()) },
  trace: { setSpan: vi.fn(() => ({})) },
  SpanStatusCode: { OK: 1, ERROR: 2 },
}));
vi.mock('../../src/core/telemetry/SpanFactory.js', () => ({
  default: spanFactoryMock,
  STANDARD_ATTRIBUTES: {
    KAFKA_TOPIC: 'kafka.topic',
    KAFKA_PARTITION: 'kafka.partition',
    KAFKA_OFFSET: 'kafka.offset',
    KAFKA_CONSUMER_GROUP: 'kafka.consumer_group',
  },
}));
vi.mock('../../src/core/telemetry/ContextPropagator.js', () => ({ ContextPropagator: propagatorMock }));
vi.mock('../../src/core/telemetry/TraceContext.js', () => ({ TraceContext: {} }));

const { QueueTracer } = await import('../../src/core/telemetry/QueueTracer.js');

describe('QueueTracer', () => {
  let span;

  beforeEach(() => {
    vi.clearAllMocks();
    span = makeSpan();
    spanFactoryMock.startSpan.mockReturnValue(span);
  });

  describe('wrapProducer', () => {
    it('produces the trace-enriched message inside a produce span for the topic', async () => {
      const produce = vi.fn(async () => 'acked');

      await expect(QueueTracer.wrapProducer(produce, 'orders')({ value: 'v' }, 'extra')).resolves.toBe('acked');
      expect(produce).toHaveBeenCalledWith({ value: 'v', headers: { traceparent: 'tp' } }, 'extra');
      expect(spanFactoryMock.withQueueProduceSpan).toHaveBeenCalledWith('orders', expect.any(Function), {
        attributes: { 'messaging.system': 'kafka', 'messaging.operation': 'produce', 'messaging.destination': 'orders' },
      });
    });
  });

  describe('wrapConsumer', () => {
    it('opens a kafka.consume span parented on the message headers and ends it OK', async () => {
      const handler = vi.fn(async () => 'processed');
      const message = { headers: { traceparent: 'tp' } };

      const result = await QueueTracer.wrapConsumer(handler, { consumerGroup: 'g1' })('orders', message, { partition: 3, offset: '42' });

      expect(result).toBe('processed');
      expect(handler).toHaveBeenCalledWith('orders', message, { partition: 3, offset: '42' });
      expect(propagatorMock.extractFromKafkaHeaders).toHaveBeenCalledWith(message.headers);
      expect(spanFactoryMock.startSpan).toHaveBeenCalledWith('kafka.consume', {
        attributes: {
          'messaging.system': 'kafka',
          'messaging.operation': 'consume',
          'messaging.destination': 'orders',
          'kafka.topic': 'orders',
          'kafka.partition': 3,
          'kafka.offset': '42',
          'kafka.consumer_group': 'g1',
        },
        parentContext: { parent: 'ctx' },
      });
      expect(span.setStatus).toHaveBeenCalledWith({ code: 1 });
      expect(span.end).toHaveBeenCalledTimes(1);
    });

    it('records the error, ends the span and rethrows when the handler fails', async () => {
      const boom = new Error('bad payload');
      const handler = vi.fn(async () => { throw boom; });

      await expect(QueueTracer.wrapConsumer(handler)('orders', {}, undefined)).rejects.toThrow(boom);
      expect(spanFactoryMock.startSpan.mock.calls[0][1]).not.toHaveProperty('parentContext');
      expect(spanFactoryMock.recordError).toHaveBeenCalledWith(span, boom);
      expect(span.end).toHaveBeenCalledTimes(1);
      expect(span.setStatus).not.toHaveBeenCalled();
    });
  });

  describe('wrapConsumerHandler', () => {
    it('runs the handler in a kafka.process.<topic> span', async () => {
      const handler = vi.fn(async () => 'ok');

      await expect(QueueTracer.wrapConsumerHandler('payments', handler, { consumerGroup: 'pay' })({}, { offset: '1' })).resolves.toBe('ok');
      expect(handler).toHaveBeenCalledWith({}, { offset: '1' });
      expect(spanFactoryMock.withSpan).toHaveBeenCalledWith('kafka.process.payments', expect.any(Function), {
        attributes: {
          'kafka.topic': 'payments',
          'kafka.consumer_group': 'pay',
          'messaging.system': 'kafka',
          'messaging.operation': 'process',
        },
      });
    });
  });

  describe('createProducerTracer / createConsumerTracer', () => {
    it('producer tracer runs fn inside a produce span for the topic', async () => {
      await expect(QueueTracer.createProducerTracer('orders').trace(async () => 5)).resolves.toBe(5);
      expect(spanFactoryMock.withQueueProduceSpan).toHaveBeenCalledWith('orders', expect.any(Function), {
        attributes: { 'messaging.system': 'kafka' },
      });
    });

    it('consumer tracer records topic, group, partition and offset', async () => {
      const tracer = QueueTracer.createConsumerTracer('orders', 'g1');

      await expect(tracer.trace({ headers: {} }, { partition: 0, offset: '9' }, async () => 'r')).resolves.toBe('r');
      expect(spanFactoryMock.withSpan).toHaveBeenCalledWith('kafka.consume', expect.any(Function), {
        parentContext: { parent: 'ctx' },
        attributes: {
          'kafka.topic': 'orders',
          'kafka.consumer_group': 'g1',
          'kafka.partition': 0,
          'kafka.offset': '9',
          'messaging.system': 'kafka',
        },
      });
    });
  });
});
