/**
 * Unit tests for backend/api/src/core/telemetry/EventTracer.js
 *
 * EventTracer is a static helper (no constructor/startTrace/endTrace API):
 *   - wrapPublish: opens an event.publish span, injects trace context, ends the span
 *   - wrapSubscribe / wrapEventHandler: run handlers inside a named span with the
 *     parent context extracted from event metadata
 *   - traceEventBus: patches publish/on on an event bus instance
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
// backend/api/test/unit/telemetry_EventTracer.test.js

import { describe, it, expect, vi } from 'vitest';
import { 
  wrapPublish, 
  wrapSubscribe, 
  wrapEventHandler, 
  traceEventBus 
} from '../../src/core/telemetry/EventTracer.js';

describe('EventTracer Telemetry Module', () => {
  it('should wrap publish methods and trace event publication', async () => {
    const mockPublish = vi.fn().mockResolvedValue({ success: true });
    const wrappedPublish = wrapPublish('order.created', mockPublish);

    const result = await wrappedPublish({ orderId: '123' });

    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect(mockPublish).toHaveBeenCalledWith({ orderId: '123' });
    expect(result).toEqual({ success: true });
  });

  it('should wrap subscribe handlers and record execution metrics', async () => {
    const mockHandler = vi.fn().mockResolvedValue(true);
    const wrappedHandler = wrapSubscribe('order.created', mockHandler);

    await wrappedHandler({ orderId: '123' });

    expect(mockHandler).toHaveBeenCalledTimes(1);
    expect(mockHandler).toHaveBeenCalledWith({ orderId: '123' });
  });

  it('should wrap generic event handlers correctly', async () => {
    const mockHandler = vi.fn().mockReturnValue('processed');
    const wrapped = wrapEventHandler('payment.processed', mockHandler);

    const res = wrapped({ paymentId: 'p-99' });

    expect(res).toBe('processed');
    expect(mockHandler).toHaveBeenCalledWith({ paymentId: 'p-99' });
  });

  it('should attach trace event bus telemetry without disrupting message flow', () => {
    const mockEventBus = {
      publish: vi.fn(),
      subscribe: vi.fn()
    };

    const tracedBus = traceEventBus(mockEventBus);

    expect(tracedBus).toBeDefined();
    expect(typeof tracedBus.publish).toBe('function');
    expect(typeof tracedBus.subscribe).toBe('function');
  });
});
const mockStartSpan = vi.fn(() => ({ setStatus: vi.fn(), end: vi.fn(), setAttributes: vi.fn(), setAttribute: vi.fn() }));
vi.mock('@opentelemetry/api', () => ({ context: { active: vi.fn(() => ({})) }, trace: { getTracer: vi.fn(() => ({ startSpan: mockStartSpan })) }, SpanStatusCode: { OK: 0, ERROR: 1 } }));
const makeSpan = () => ({ setStatus: vi.fn(), end: vi.fn(), setAttributes: vi.fn(), setAttribute: vi.fn() });

const { spanFactoryMock, propagatorMock } = vi.hoisted(() => ({
  spanFactoryMock: {
    startEventPublishSpan: vi.fn(),
    recordError: vi.fn(),
    withSpan: vi.fn(async (_name, fn) => fn()),
  },
  propagatorMock: {
    injectIntoEventPayload: vi.fn((event) => ({ ...event, injected: true })),
    extractFromEventPayload: vi.fn(() => ({ parent: 'ctx' })),
  },
}));

vi.mock('@opentelemetry/api', () => ({
  context: { active: vi.fn(() => ({})), with: vi.fn((_ctx, fn) => fn()) },
  trace: { setSpan: vi.fn(() => ({})) },
  SpanStatusCode: { OK: 1, ERROR: 2 },
}));
vi.mock('../../src/core/telemetry/SpanFactory.js', () => ({
  default: spanFactoryMock,
  STANDARD_ATTRIBUTES: { EVENT_TYPE: 'event.type' },
}));
vi.mock('../../src/core/telemetry/ContextPropagator.js', () => ({ ContextPropagator: propagatorMock }));

const { EventTracer } = await import('../../src/core/telemetry/EventTracer.js');

describe('EventTracer', () => {
  let span;

  beforeEach(() => {
    vi.clearAllMocks();
    span = makeSpan();
    spanFactoryMock.startEventPublishSpan.mockReturnValue(span);
  });

  describe('wrapPublish', () => {
    it('opens a publish span with source/eventId from event metadata and ends it OK', () => {
      const publish = vi.fn(() => 'published');
      const bus = {};
      const event = { metadata: { eventType: 'order.created', source: 'orders', eventId: 'e-1' } };

      const result = EventTracer.wrapPublish(publish, bus)(event, 'opts');

      expect(result).toBe('published');
      expect(spanFactoryMock.startEventPublishSpan).toHaveBeenCalledWith('order.created', { source: 'orders', eventId: 'e-1' });
      expect(publish).toHaveBeenCalledWith({ ...event, injected: true }, 'opts', undefined);
      expect(publish.mock.contexts[0]).toBe(bus);
      expect(span.setStatus).toHaveBeenCalledWith({ code: 1 });
      expect(span.end).toHaveBeenCalledTimes(1);
    });

    it('takes the event type from a string first argument and the source from payload metadata', () => {
      const publish = vi.fn();
      EventTracer.wrapPublish(publish, {})('trip.started', { metadata: { source: 'tracker' } });

      expect(spanFactoryMock.startEventPublishSpan).toHaveBeenCalledWith('trip.started', { source: 'tracker', eventId: null });
      expect(propagatorMock.injectIntoEventPayload).not.toHaveBeenCalled();
      expect(publish).toHaveBeenCalledWith('trip.started', { metadata: { source: 'tracker' } }, undefined);
    });

    it('publishes without a span when no event type can be derived', () => {
      const publish = vi.fn(() => 'raw');
      expect(EventTracer.wrapPublish(publish, {})({ payload: 1 })).toBe('raw');
      expect(spanFactoryMock.startEventPublishSpan).not.toHaveBeenCalled();
    });

    it('records the error, ends the span and rethrows when publish throws', () => {
      const boom = new Error('broker down');
      const publish = vi.fn(() => { throw boom; });

      expect(() => EventTracer.wrapPublish(publish, {})('order.created')).toThrow(boom);
      expect(spanFactoryMock.recordError).toHaveBeenCalledWith(span, boom);
      expect(span.end).toHaveBeenCalledTimes(1);
      expect(span.setStatus).not.toHaveBeenCalled();
    });
  });

  describe('wrapSubscribe', () => {
    it('runs the handler in an event.subscribe span parented on the propagated context', async () => {
      async function onOrder(evt) { return evt.id; }
      const event = { id: 7, metadata: { traceContext: { traceparent: 'x' } } };

      await expect(EventTracer.wrapSubscribe('order.created', onOrder)(event)).resolves.toBe(7);
      expect(propagatorMock.extractFromEventPayload).toHaveBeenCalledWith(event);
      expect(spanFactoryMock.withSpan).toHaveBeenCalledWith('event.subscribe.order.created', expect.any(Function), {
        attributes: { 'event.type': 'order.created', 'handler.name': 'onOrder' },
        parentContext: { parent: 'ctx' },
      });
    });

    it('omits parentContext when the event carries no trace context', async () => {
      await EventTracer.wrapSubscribe('x', async () => 1)({});
      const options = spanFactoryMock.withSpan.mock.calls[0][2];
      expect(options).not.toHaveProperty('parentContext');
      expect(options.attributes['handler.name']).toBe('anonymous');
    });
  });

  describe('wrapEventHandler', () => {
    it('names the span after the handler and records event type and source', async () => {
      const handler = vi.fn(async () => 'done');
      const event = { metadata: { eventType: 'bid.placed', source: 'bids' } };

      await expect(EventTracer.wrapEventHandler('bidNotifier', handler)(event)).resolves.toBe('done');
      expect(handler).toHaveBeenCalledWith(event);
      expect(spanFactoryMock.withSpan).toHaveBeenCalledWith('event.handler.bidNotifier', expect.any(Function), {
        attributes: { 'event.type': 'bid.placed', 'handler.name': 'bidNotifier', 'handler.source': 'bids' },
      });
    });
  });

  describe('traceEventBus', () => {
    it('wraps publish and function subscribers, and passes non-function subscribers through', async () => {
      const publish = vi.fn();
      const on = vi.fn();
      const bus = { publish, on };

      expect(EventTracer.traceEventBus(bus)).toBe(bus);
      expect(bus.publish).not.toBe(publish);

      bus.publish('order.created');
      expect(publish).toHaveBeenCalledTimes(1);
      expect(spanFactoryMock.startEventPublishSpan).toHaveBeenCalledWith('order.created', expect.any(Object));

      const handler = vi.fn(async () => 'handled');
      bus.on('order.created', handler);
      const wrapped = on.mock.calls[0][1];
      expect(wrapped).not.toBe(handler);
      await expect(wrapped({})).resolves.toBe('handled');

      bus.on('order.created', 'not-a-function');
      expect(on).toHaveBeenLastCalledWith('order.created', 'not-a-function');
    });
  });
});
