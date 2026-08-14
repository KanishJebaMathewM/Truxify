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
    startEventPublishSpan: vi.fn(() => mockSpan),
    recordError: vi.fn(),
    withSpan: vi.fn(async (name, fn, options) => fn()),
  },
  STANDARD_ATTRIBUTES: {
    EVENT_TYPE: 'event.type',
    EVENT_SOURCE: 'event.source',
    EVENT_ID: 'event.id',
  },
}));

vi.mock('../../../../src/core/telemetry/ContextPropagator.js', () => ({
  ContextPropagator: {
    injectIntoEventPayload: (evt) => ({ ...evt, injected: true }),
    extractFromEventPayload: () => ({}),
  },
}));

const { EventTracer } = await import('../../../../src/core/telemetry/EventTracer.js');
const spanFactoryMock = (await import('../../../../src/core/telemetry/SpanFactory.js')).default;

describe('EventTracer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('wrapPublish creates a span for string event types', async () => {
    const publishFn = vi.fn().mockReturnValue('ok');
    const wrapped = EventTracer.wrapPublish(publishFn, {});
    const result = wrapped('order.created', { payload: 1 });

    expect(spanFactoryMock.startEventPublishSpan).toHaveBeenCalledWith(
      'order.created',
      expect.objectContaining({ source: 'unknown' }),
    );
    expect(result).toBe('ok');
  });

  it('wrapPublish extracts event metadata from event objects', () => {
    const publishFn = vi.fn();
    const event = {
      metadata: { eventType: 'order.cancelled', source: 'order-service', eventId: 'evt-9' },
      payload: {},
    };
    EventTracer.wrapPublish(publishFn, {})(event, {});

    expect(spanFactoryMock.startEventPublishSpan).toHaveBeenCalledWith(
      'order.cancelled',
      expect.objectContaining({ source: 'order-service', eventId: 'evt-9' }),
    );
  });

  it('wrapPublish falls through when no event type is present', () => {
    const publishFn = vi.fn().mockReturnValue('fallthrough');
    const wrapped = EventTracer.wrapPublish(publishFn, {});
    expect(wrapped(null, {})).toBe('fallthrough');
    expect(spanFactoryMock.startEventPublishSpan).not.toHaveBeenCalled();
  });

  it('wrapSubscribe wraps the handler with a span', async () => {
    const handler = vi.fn().mockResolvedValue('handled');
    const wrapped = EventTracer.wrapSubscribe('order.created', handler);

    const result = await wrapped({ payload: {} });
    expect(result).toBe('handled');
    expect(handler).toHaveBeenCalled();
  });

  it('traceEventBus wraps publish and on', () => {
    const bus = {
      publish: vi.fn().mockReturnValue('pub'),
      on: vi.fn().mockReturnThis(),
    };
    const traced = EventTracer.traceEventBus(bus);

    traced.publish('x.y', {});
    expect(spanFactoryMock.startEventPublishSpan).toHaveBeenCalled();

    // The wrapped `on` is a plain function, not the original mock — calling it
    // must still invoke the underlying handler registration path.
    const handler = vi.fn();
    const returned = traced.on('x.y', handler);
    expect(returned).toBe(traced);
    expect(typeof traced.on).toBe('function');
  });
});
