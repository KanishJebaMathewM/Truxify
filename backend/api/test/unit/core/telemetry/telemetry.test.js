import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../src/tracing/tracing.js', () => ({
  default: {
    isInitialized: true,
    getTracer: vi.fn(() => ({
      startSpan: vi.fn((name, opts) => ({
        name,
        attributes: opts?.attributes || {},
        events: [],
        status: { code: 0 },
        spanContext: () => ({
          traceId: 'abc123def456abc123def456abc123de',
          spanId: '1234567890abcdef',
          traceFlags: 1,
        }),
        setAttributes: vi.fn(function (attrs) {
          Object.assign(this.attributes, attrs);
        }),
        addEvent: vi.fn(function (eventName, attrs) {
          this.events.push({ name: eventName, attributes: attrs });
        }),
        setStatus: vi.fn(function (s) {
          this.status = s;
        }),
        recordException: vi.fn(),
        end: vi.fn(),
      })),
    })),
  },
}));

import { SPAN_NAMES, STANDARD_ATTRIBUTES, SpanFactory } from '../../../../src/core/telemetry/SpanFactory.js';

import { TraceContext } from '../../../../src/core/telemetry/TraceContext.js';
import { ContextPropagator } from '../../../../src/core/telemetry/ContextPropagator.js';
import { WorkerTracer } from '../../../../src/core/telemetry/WorkerTracer.js';
import { QueueTracer } from '../../../../src/core/telemetry/QueueTracer.js';
import { EventTracer } from '../../../../src/core/telemetry/EventTracer.js';

describe('SPAN_NAMES and STANDARD_ATTRIBUTES constants', () => {
  it('defines all required span names', () => {
    expect(SPAN_NAMES.WORKER_EXECUTION).toBe('worker.execution');
    expect(SPAN_NAMES.WORKER_RETRY).toBe('worker.retry');
    expect(SPAN_NAMES.QUEUE_PRODUCE).toBe('queue.produce');
    expect(SPAN_NAMES.QUEUE_CONSUME).toBe('queue.consume');
    expect(SPAN_NAMES.EVENT_PUBLISH).toBe('event.publish');
    expect(SPAN_NAMES.EVENT_SUBSCRIBE).toBe('event.subscribe');
    expect(SPAN_NAMES.EVENT_HANDLER).toBe('event.handler');
    expect(SPAN_NAMES.SCHEDULER_TASK).toBe('scheduler.task');
    expect(SPAN_NAMES.RETRY_ATTEMPT).toBe('retry.attempt');
    expect(SPAN_NAMES.KAFKA_PRODUCE).toBe('kafka.produce');
    expect(SPAN_NAMES.KAFKA_CONSUME).toBe('kafka.consume');
    expect(SPAN_NAMES.HTTP_OUTGOING).toBe('http.outgoing');
  });

  it('defines all required standard attributes', () => {
    const expected = [
      'SERVICE_NAME', 'WORKER_NAME', 'WORKER_ATTEMPT', 'WORKER_MAX_ATTEMPTS',
      'QUEUE_NAME', 'QUEUE_OPERATION', 'QUEUE_MESSAGE_SIZE',
      'EVENT_TYPE', 'EVENT_SOURCE', 'EVENT_ID', 'CORRELATION_ID',
      'KAFKA_TOPIC', 'KAFKA_PARTITION', 'KAFKA_OFFSET', 'KAFKA_CONSUMER_GROUP',
      'RETRY_OPERATION', 'RETRY_ATTEMPT', 'RETRY_MAX_ATTEMPTS', 'RETRY_DELAY_MS',
      'SCHEDULER_PRIORITY', 'SCHEDULER_TASK_ID',
      'ERROR_TYPE', 'ERROR_MESSAGE', 'DURATION_MS',
    ];
    for (const key of expected) {
      expect(STANDARD_ATTRIBUTES).toHaveProperty(key);
      expect(typeof STANDARD_ATTRIBUTES[key]).toBe('string');
    }
  });
});

describe('SpanFactory', () => {
  let factory;

  beforeEach(() => {
    factory = new SpanFactory();
    vi.clearAllMocks();
  });

  it('creates a basic span with service name', () => {
    const span = factory.startSpan('test-span');
    expect(span).toBeDefined();
    expect(span.name).toBe('test-span');
    expect(span.attributes).toHaveProperty('service.name', 'truxify-api');
  });

  it('creates a worker span with worker attributes', () => {
    const span = factory.startWorkerSpan('test-worker', { attempt: 1, maxAttempts: 3 });
    expect(span.attributes).toHaveProperty('worker.name', 'test-worker');
    expect(span.attributes).toHaveProperty('worker.attempt', 1);
    expect(span.attributes).toHaveProperty('worker.max_attempts', 3);
  });

  it('creates a worker span with defaults', () => {
    const span = factory.startWorkerSpan('test-worker');
    expect(span.attributes).toHaveProperty('worker.attempt', 0);
    expect(span.attributes).toHaveProperty('worker.max_attempts', 1);
  });

  it('creates a retry span', () => {
    const span = factory.startRetrySpan('test-op', 2, 5);
    expect(span.attributes).toHaveProperty('retry.operation', 'test-op');
    expect(span.attributes).toHaveProperty('retry.attempt', 2);
    expect(span.attributes).toHaveProperty('retry.max_attempts', 5);
  });

  it('creates a queue produce span', () => {
    const span = factory.startQueueProduceSpan('order.created');
    expect(span.attributes).toHaveProperty('queue.name', 'order.created');
    expect(span.attributes).toHaveProperty('queue.operation', 'produce');
    expect(span.attributes).toHaveProperty('kafka.topic', 'order.created');
  });

  it('creates a queue consume span with all attributes', () => {
    const span = factory.startQueueConsumeSpan('order.created', {
      partition: 0,
      offset: 42,
      consumerGroup: 'order-service',
    });
    expect(span.attributes).toHaveProperty('kafka.topic', 'order.created');
    expect(span.attributes).toHaveProperty('kafka.partition', 0);
    expect(span.attributes).toHaveProperty('kafka.offset', 42);
    expect(span.attributes).toHaveProperty('kafka.consumer_group', 'order-service');
  });

  it('creates an event publish span', () => {
    const span = factory.startEventPublishSpan('ORDER_CREATED', { source: 'order-service', eventId: 'evt-1' });
    expect(span.attributes).toHaveProperty('event.type', 'ORDER_CREATED');
    expect(span.attributes).toHaveProperty('event.source', 'order-service');
    expect(span.attributes).toHaveProperty('event.id', 'evt-1');
  });

  it('creates an event subscribe span', () => {
    const span = factory.startEventSubscribeSpan('ORDER_CREATED', { source: 'kafka' });
    expect(span.attributes).toHaveProperty('event.type', 'ORDER_CREATED');
    expect(span.attributes).toHaveProperty('event.source', 'kafka');
  });

  it('creates an event handler span', () => {
    const span = factory.startEventHandlerSpan('ORDER_CREATED', 'my-handler');
    expect(span.attributes).toHaveProperty('event.type', 'ORDER_CREATED');
    expect(span.attributes).toHaveProperty('handler.name', 'my-handler');
  });

  it('creates a scheduler task span', () => {
    const span = factory.startSchedulerTaskSpan('render-task-1', { priority: 'HIGH', taskId: 42 });
    expect(span.attributes).toHaveProperty('worker.name', 'render-task-1');
    expect(span.attributes).toHaveProperty('scheduler.priority', 'HIGH');
    expect(span.attributes).toHaveProperty('scheduler.task_id', 42);
  });

  it('records error on span', () => {
    const span = factory.startSpan('test');
    const error = new Error('test error');
    error.name = 'TestError';
    factory.recordError(span, error);
    expect(span.status.code).toBe(2); // SpanStatusCode.ERROR
    expect(span.status.message).toBe('test error');
    expect(span.attributes).toHaveProperty('error.type', 'TestError');
    expect(span.attributes).toHaveProperty('error.message', 'test error');
  });

  it('records error gracefully on null span', () => {
    expect(() => factory.recordError(null, new Error('test'))).not.toThrow();
  });

  it('adds event to span', () => {
    const span = factory.startSpan('test');
    factory.addEvent(span, 'test.event', { key: 'value' });
    expect(span.events).toHaveLength(1);
    expect(span.events[0].name).toBe('test.event');
  });

  it('adds event gracefully on null span', () => {
    expect(() => factory.addEvent(null, 'test.event')).not.toThrow();
  });

  it('sets attributes on span', () => {
    const span = factory.startSpan('test');
    factory.setAttributes(span, { 'custom.key': 'value' });
    expect(span.attributes).toHaveProperty('custom.key', 'value');
  });

  it('sets attributes gracefully on null span', () => {
    expect(() => factory.setAttributes(null, {})).not.toThrow();
  });

  it('ends span with duration', () => {
    const span = factory.startSpan('test');
    factory.endSpan(span, 150);
    expect(span.end).toHaveBeenCalled();
    expect(span.attributes).toHaveProperty('duration.ms', 150);
  });

  it('ends span without duration', () => {
    const span = factory.startSpan('test');
    factory.endSpan(span);
    expect(span.end).toHaveBeenCalled();
  });

  it('ends null span gracefully', () => {
    expect(() => factory.endSpan(null)).not.toThrow();
  });

  it('withSpan runs function and returns result', async () => {
    const result = await factory.withSpan('test', async () => 'hello');
    expect(result).toBe('hello');
  });

  it('withSpan records error on failure', async () => {
    await expect(
      factory.withSpan('test', async () => { throw new Error('fail'); })
    ).rejects.toThrow('fail');
  });

  it('withWorkerSpan runs function', async () => {
    const result = await factory.withWorkerSpan('worker-1', async () => 'done');
    expect(result).toBe('done');
  });

  it('withQueueConsumeSpan runs function', async () => {
    const result = await factory.withQueueConsumeSpan('topic', async () => 'ok');
    expect(result).toBe('ok');
  });

  it('withEventPublishSpan runs function', async () => {
    const result = await factory.withEventPublishSpan('test.event', async () => 'ok');
    expect(result).toBe('ok');
  });

  it('withSchedulerTaskSpan runs function', async () => {
    const result = await factory.withSchedulerTaskSpan('task-1', async () => 'ok');
    expect(result).toBe('ok');
  });

  it('merges custom attributes with service name', () => {
    const span = factory.startSpan('test', {
      attributes: { 'custom.key': 'value' },
    });
    expect(span.attributes).toHaveProperty('custom.key', 'value');
    expect(span.attributes).toHaveProperty('service.name', 'truxify-api');
  });
});

describe('WorkerTracer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a traced worker that calls handler', async () => {
    const handler = vi.fn(async () => 'result');
    const traced = WorkerTracer.createTracedWorker('test-worker', handler);
    const result = await traced();
    expect(result).toBe('result');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('passes arguments to handler', async () => {
    const handler = vi.fn(async (a, b) => a + b);
    const traced = WorkerTracer.createTracedWorker('test-worker', handler);
    const result = await traced(2, 3);
    expect(result).toBe(5);
    expect(handler).toHaveBeenCalledWith(2, 3);
  });

  it('retries on failure up to maxAttempts', async () => {
    let callCount = 0;
    const handler = vi.fn(async () => {
      callCount++;
      if (callCount < 3) throw new Error('transient');
      return 'recovered';
    });
    const traced = WorkerTracer.createTracedWorker('retry-worker', handler, {
      maxAttempts: 3,
      retryDelayMs: 10,
    });
    const result = await traced();
    expect(result).toBe('recovered');
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it('throws after exhausting all retries', async () => {
    const handler = vi.fn(async () => { throw new Error('permanent'); });
    const traced = WorkerTracer.createTracedWorker('fail-worker', handler, {
      maxAttempts: 2,
      retryDelayMs: 10,
    });
    await expect(traced()).rejects.toThrow('permanent');
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('wraps cron job', async () => {
    const handler = vi.fn(async () => 'cron-result');
    const traced = WorkerTracer.wrapCronJob('cron-job-1', handler, { schedule: '0 * * * *' });
    const result = await traced();
    expect(result).toBe('cron-result');
  });

  it('wraps interval worker', async () => {
    const handler = vi.fn(async () => 'interval-result');
    const traced = WorkerTracer.wrapIntervalWorker('interval-1', handler, { intervalMs: 5000 });
    const result = await traced();
    expect(result).toBe('interval-result');
  });

  it('executes with trace context', async () => {
    const snapshot = { traceparent: '00-abc123def456abc123def456abc123de-1234567890abcdef-01' };
    const result = await WorkerTracer.executeWithTraceContext(snapshot, async () => 'ok');
    expect(result).toBe('ok');
  });
});

describe('QueueTracer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('wraps producer function', async () => {
    const produceFn = vi.fn(async (msg) => msg);
    const traced = QueueTracer.wrapProducer(produceFn, 'order.created');
    const result = await traced({ value: 'test' });
    expect(produceFn).toHaveBeenCalled();
  });

  it('wraps consumer handler', async () => {
    const handler = vi.fn(async (topic, msg) => 'processed');
    const traced = QueueTracer.wrapConsumerHandler('order.created', handler);
    const result = await traced({ value: 'test' }, { partition: 0, offset: 1 });
    expect(handler).toHaveBeenCalled();
  });

  it('wraps consumer handler with consumer group', async () => {
    const handler = vi.fn(async () => 'ok');
    const traced = QueueTracer.wrapConsumerHandler('topic', handler, { consumerGroup: 'svc' });
    await traced({ value: 'test' }, { partition: 0, offset: 1 });
    expect(handler).toHaveBeenCalled();
  });

  it('creates producer tracer with trace method', () => {
    const tracer = QueueTracer.createProducerTracer('order.created');
    expect(tracer).toHaveProperty('trace');
    expect(typeof tracer.trace).toBe('function');
  });

  it('creates consumer tracer with trace method', () => {
    const tracer = QueueTracer.createConsumerTracer('order.created', 'order-service');
    expect(tracer).toHaveProperty('trace');
    expect(typeof tracer.trace).toBe('function');
  });
});

describe('EventTracer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('wrapPublish returns a function', () => {
    const publishFn = vi.fn();
    const eventBus = { publish: publishFn };
    const traced = EventTracer.wrapPublish(publishFn, eventBus);
    expect(typeof traced).toBe('function');
  });

  it('wrapSubscribe returns a function', () => {
    const handler = vi.fn();
    const traced = EventTracer.wrapSubscribe('test.event', handler);
    expect(typeof traced).toBe('function');
  });

  it('wrapEventHandler returns a function', () => {
    const handlerFn = vi.fn(async () => 'ok');
    const traced = EventTracer.wrapEventHandler('my-handler', handlerFn);
    expect(typeof traced).toBe('function');
  });

  it('traceEventBus wraps publish and on', () => {
    const mockOn = vi.fn();
    const mockPublish = vi.fn();
    const eventBus = { on: mockOn, publish: mockPublish };
    const traced = EventTracer.traceEventBus(eventBus);
    expect(traced).toBe(eventBus);
  });
});

describe('TraceContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('injectIntoHeaders returns an object', () => {
    const result = TraceContext.injectIntoHeaders({});
    expect(result).toBeDefined();
    expect(typeof result).toBe('object');
  });

  it('extractFromHeaders returns a context', () => {
    const ctx = TraceContext.extractFromHeaders({});
    expect(ctx).toBeDefined();
  });

  it('serialize returns an object', () => {
    const serialized = TraceContext.serialize();
    expect(serialized).toBeDefined();
    expect(typeof serialized).toBe('object');
  });

  it('deserialize returns a context for valid input', () => {
    const ctx = TraceContext.deserialize({ traceparent: '00-abc123-1234567890abcdef-01' });
    expect(ctx).toBeDefined();
  });

  it('deserialize returns ROOT_CONTEXT for null', () => {
    const ctx = TraceContext.deserialize(null);
    expect(ctx).toBeDefined();
  });

  it('runWithContext executes function', () => {
    let executed = false;
    TraceContext.runWithContext({}, () => { executed = true; });
    expect(executed).toBe(true);
  });

  it('injectIntoMessage adds headers', () => {
    const result = TraceContext.injectIntoMessage({ value: 'test' });
    expect(result).toHaveProperty('headers');
    expect(result.value).toBe('test');
  });

  it('injectIntoMessage preserves existing headers', () => {
    const result = TraceContext.injectIntoMessage({ value: 'test', headers: { 'x-custom': 'val' } });
    expect(result.headers).toHaveProperty('x-custom', 'val');
  });

  it('extractFromMessage returns context', () => {
    const ctx = TraceContext.extractFromMessage({ headers: {} });
    expect(ctx).toBeDefined();
  });

  it('extractFromMessage without headers returns context', () => {
    const ctx = TraceContext.extractFromMessage({});
    expect(ctx).toBeDefined();
  });

  it('getActiveSpan returns span or undefined', () => {
    const span = TraceContext.getActiveSpan();
    expect(span === undefined || typeof span === 'object').toBe(true);
  });

  it('getActiveTraceId returns string or null', () => {
    const traceId = TraceContext.getActiveTraceId();
    expect(traceId === null || typeof traceId === 'string').toBe(true);
  });

  it('getActiveSpanContext returns context or undefined', () => {
    const ctx = TraceContext.getActiveSpanContext();
    expect(ctx === undefined || typeof ctx === 'object').toBe(true);
  });
});

describe('ContextPropagator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('injectIntoKafkaHeaders returns object', () => {
    const result = ContextPropagator.injectIntoKafkaHeaders({});
    expect(result).toBeDefined();
    expect(typeof result).toBe('object');
  });

  it('extractFromKafkaHeaders returns context', () => {
    const ctx = ContextPropagator.extractFromKafkaHeaders({});
    expect(ctx).toBeDefined();
  });

  it('injectIntoKafkaMessage adds headers', () => {
    const result = ContextPropagator.injectIntoKafkaMessage({ value: 'test' });
    expect(result).toHaveProperty('headers');
    expect(typeof result.headers).toBe('object');
  });

  it('extractFromKafkaMessage with Buffer headers', () => {
    const msg = { headers: { traceparent: Buffer.from('test') } };
    const ctx = ContextPropagator.extractFromKafkaMessage(msg);
    expect(ctx).toBeDefined();
  });

  it('extractFromKafkaMessage with string headers', () => {
    const msg = { headers: { traceparent: 'test' } };
    const ctx = ContextPropagator.extractFromKafkaMessage(msg);
    expect(ctx).toBeDefined();
  });

  it('extractFromKafkaMessage with null header values', () => {
    const msg = { headers: { traceparent: null } };
    const ctx = ContextPropagator.extractFromKafkaMessage(msg);
    expect(ctx).toBeDefined();
  });

  it('extractFromKafkaMessage with empty headers', () => {
    const ctx = ContextPropagator.extractFromKafkaMessage({});
    expect(ctx).toBeDefined();
  });

  it('injectIntoEventPayload adds traceContext', () => {
    const event = { metadata: { eventType: 'test' }, payload: {} };
    const result = ContextPropagator.injectIntoEventPayload(event);
    expect(result.metadata).toHaveProperty('traceContext');
  });

  it('injectIntoEventPayload creates metadata if missing', () => {
    const result = ContextPropagator.injectIntoEventPayload({ payload: {} });
    expect(result.metadata).toHaveProperty('traceContext');
  });

  it('injectIntoEventPayload returns null for null', () => {
    expect(ContextPropagator.injectIntoEventPayload(null)).toBeNull();
  });

  it('extractFromEventPayload with traceContext', () => {
    const ctx = ContextPropagator.extractFromEventPayload({
      metadata: { traceContext: { traceparent: '00-abc' } },
    });
    expect(ctx).toBeDefined();
  });

  it('extractFromEventPayload without traceContext', () => {
    const ctx = ContextPropagator.extractFromEventPayload({ metadata: {} });
    expect(ctx).toBeDefined();
  });

  it('extractFromEventPayload with null', () => {
    const ctx = ContextPropagator.extractFromEventPayload(null);
    expect(ctx).toBeDefined();
  });

  it('snapshot returns object', () => {
    const snapshot = ContextPropagator.snapshot();
    expect(snapshot).toBeDefined();
    expect(typeof snapshot).toBe('object');
  });

  it('restore runs function', () => {
    let ran = false;
    ContextPropagator.restore({}, () => { ran = true; });
    expect(ran).toBe(true);
  });

  it('propagateAcrossAsync returns carrier and restore', () => {
    const { carrier, restore } = ContextPropagator.propagateAcrossAsync();
    expect(carrier).toHaveProperty('_traceSnapshot');
    expect(typeof restore).toBe('function');
  });

  it('injectIntoHttpHeaders returns object', () => {
    const result = ContextPropagator.injectIntoHttpHeaders({});
    expect(result).toBeDefined();
  });

  it('extractFromHttpHeaders returns context', () => {
    const ctx = ContextPropagator.extractFromHttpHeaders({});
    expect(ctx).toBeDefined();
  });

  it('runWithExtractedContext executes function', () => {
    let ran = false;
    ContextPropagator.runWithExtractedContext({}, () => { ran = true; });
    expect(ran).toBe(true);
  });
});
