import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSpan = {
  setStatus: vi.fn(),
  end: vi.fn(),
  recordException: vi.fn(),
  setAttribute: vi.fn(),
  setAttributes: vi.fn(),
};

vi.mock('@opentelemetry/api', () => ({
  context: {
    active: vi.fn().mockReturnValue({ contextId: 'active-context' }),
    with: vi.fn((_ctx, fn) => fn()),
  },
  trace: {
    setSpan: vi.fn((ctx, span) => ({ ...ctx, span })),
    getSpan: vi.fn(),
    getActiveSpan: vi.fn(),
  },
  SpanStatusCode: { OK: 0, ERROR: 1, UNSET: 2 },
}));

vi.mock('../../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../src/core/telemetry/SpanFactory.js', () => ({
  default: {
    startEventHandlerSpan: vi.fn().mockReturnValue(mockSpan),
    recordError: vi.fn(),
  },
}));

vi.mock('../../../src/core/telemetry/ContextPropagator.js', () => ({
  ContextPropagator: {
    extractFromEventPayload: vi.fn((event) =>
      event?.metadata?.traceContext ? { parentTrace: event.metadata.traceContext } : undefined,
    ),
    injectIntoEventPayload: vi.fn((e) => e),
    snapshot: vi.fn().mockReturnValue({}),
    serialize: vi.fn().mockReturnValue({}),
  },
}));

const { EventHandler } = await import('../../../src/core/events/EventHandler.js');
const { context, trace, SpanStatusCode } = await import('@opentelemetry/api');
const { default: spanFactory } = await import('../../../src/core/telemetry/SpanFactory.js');
const { ContextPropagator } = await import('../../../src/core/telemetry/ContextPropagator.js');

describe('EventHandler wrapper contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    spanFactory.startEventHandlerSpan.mockReturnValue(mockSpan);
  });

  describe('Factory and instantiation contract', () => {
    it('creates an EventHandler instance via EventHandler.wrap with options preserved', () => {
      const fn = vi.fn().mockResolvedValue('ok');
      const onError = vi.fn();
      const handler = EventHandler.wrap(fn, {
        name: 'customOrderHandler',
        timeout: 10000,
        retryCount: 3,
        onError,
      });

      expect(handler).toBeInstanceOf(EventHandler);
      expect(handler.name).toBe('customOrderHandler');
      expect(handler._timeout).toBe(10000);
      expect(handler._retryCount).toBe(3);
      expect(handler._onError).toBe(onError);
    });

    it('rejects non-function handlers when using wrap() or constructor', () => {
      expect(() => EventHandler.wrap(null)).toThrow('EventHandler requires a function handler');
      expect(() => EventHandler.wrap(undefined)).toThrow('EventHandler requires a function handler');
      expect(() => EventHandler.wrap(12345)).toThrow('EventHandler requires a function handler');
      expect(() => EventHandler.wrap('not-a-function')).toThrow('EventHandler requires a function handler');
      expect(() => EventHandler.wrap({})).toThrow('EventHandler requires a function handler');
      expect(() => new EventHandler(null)).toThrow('EventHandler requires a function handler');
    });

    it('resolves name in order: options.name > handler.name > anonymous', () => {
      function processShipment() {}
      const withOptionsName = EventHandler.wrap(processShipment, { name: 'overrideName' });
      expect(withOptionsName.name).toBe('overrideName');

      const withFunctionName = EventHandler.wrap(processShipment);
      expect(withFunctionName.name).toBe('processShipment');

      const withAnonymous = EventHandler.wrap(() => {});
      expect(withAnonymous.name).toBe('anonymous');
    });

    it('applies default configuration values when options are omitted', () => {
      const handler = EventHandler.wrap(() => {});
      expect(handler.name).toBe('anonymous');
      expect(handler._timeout).toBe(30000);
      expect(handler._retryCount).toBe(0);
      expect(handler._onError).toBeNull();
    });
  });

  describe('Argument forwarding contract', () => {
    it('forwards the exact event object to the wrapped handler without modification', async () => {
      const fn = vi.fn().mockResolvedValue('handled');
      const handler = EventHandler.wrap(fn, { name: 'argForwarder' });
      const event = {
        metadata: { eventType: 'ORDER_PLACED', version: '1.0' },
        payload: { orderId: 'ord-123', amount: 99.5 },
      };

      await handler.handle(event);

      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith(event);
    });

    it('forwards primitive and array events without error', async () => {
      const fn = vi.fn().mockResolvedValue('primitive-ok');
      const handler = EventHandler.wrap(fn, { name: 'primitiveHandler' });

      await handler.handle('raw-event-string');
      expect(fn).toHaveBeenCalledWith('raw-event-string');

      await handler.handle([1, 2, 3]);
      expect(fn).toHaveBeenCalledWith([1, 2, 3]);
    });

    it('safely handles omitted event argument (undefined/null)', async () => {
      const fn = vi.fn().mockResolvedValue('no-arg-handled');
      const handler = EventHandler.wrap(fn, { name: 'noArgHandler' });

      const result = await handler.handle();
      expect(fn).toHaveBeenCalledWith(undefined);
      expect(result).toBe('no-arg-handled');

      const nullResult = await handler.handle(null);
      expect(fn).toHaveBeenCalledWith(null);
      expect(nullResult).toBe('no-arg-handled');
    });
  });

  describe('Return value propagation contract', () => {
    it('propagates resolved asynchronous return values', async () => {
      const expectedData = { orderId: 'ord-789', status: 'CONFIRMED' };
      const fn = vi.fn().mockResolvedValue(expectedData);
      const handler = EventHandler.wrap(fn);

      const result = await handler.handle({ type: 'ORDER_CONFIRMED' });
      expect(result).toEqual(expectedData);
    });

    it('propagates synchronous return values from wrapped handlers', async () => {
      const fn = vi.fn().mockReturnValue('synchronous-return');
      const handler = EventHandler.wrap(fn);

      const result = await handler.handle({});
      expect(result).toBe('synchronous-return');
    });

    it('propagates falsy return values correctly (false, 0, null, empty string, undefined)', async () => {
      const falseHandler = EventHandler.wrap(() => false);
      expect(await falseHandler.handle({})).toBe(false);

      const zeroHandler = EventHandler.wrap(() => 0);
      expect(await zeroHandler.handle({})).toBe(0);

      const nullHandler = EventHandler.wrap(() => null);
      expect(await nullHandler.handle({})).toBeNull();

      const emptyStrHandler = EventHandler.wrap(() => '');
      expect(await emptyStrHandler.handle({})).toBe('');

      const undefinedHandler = EventHandler.wrap(() => undefined);
      expect(await undefinedHandler.handle({})).toBeUndefined();
    });
  });

  describe('Invocation context and execution contract', () => {
    it('preserves the bound execution context when wrapping a method', async () => {
      class ServiceWorker {
        constructor(tag) {
          this.tag = tag;
        }

        execute(event) {
          return `${this.tag}:${event.id}`;
        }
      }

      const worker = new ServiceWorker('worker-alpha');
      const handler = EventHandler.wrap(worker.execute.bind(worker), { name: 'boundWorker' });

      const result = await handler.handle({ id: 'evt-42' });
      expect(result).toBe('worker-alpha:evt-42');
    });

    it('invokes the wrapped handler exactly once per handle() call', async () => {
      const fn = vi.fn().mockResolvedValue('ok');
      const handler = EventHandler.wrap(fn);

      await handler.handle({ run: 1 });
      await handler.handle({ run: 2 });

      expect(fn).toHaveBeenCalledTimes(2);
      expect(fn).toHaveBeenNthCalledWith(1, { run: 1 });
      expect(fn).toHaveBeenNthCalledWith(2, { run: 2 });
    });
  });

  describe('Error propagation and fallback contract', () => {
    it('re-throws error when wrapped handler throws and no onError is configured', async () => {
      const error = new Error('Database connection failed');
      const fn = vi.fn().mockRejectedValue(error);
      const handler = EventHandler.wrap(fn, { name: 'dbHandler' });

      await expect(handler.handle({ type: 'DB_WRITE' })).rejects.toThrow('Database connection failed');
    });

    it('re-throws synchronous errors thrown by handler when no onError is configured', async () => {
      const fn = vi.fn(() => {
        throw new Error('Immediate validation throw');
      });
      const handler = EventHandler.wrap(fn, { name: 'syncThrowHandler' });

      await expect(handler.handle({})).rejects.toThrow('Immediate validation throw');
    });

    it('calls onError with (error, event) and returns fallback value on rejection', async () => {
      const err = new Error('Upstream timeout');
      const event = { id: 'evt-999', payload: { data: 'test' } };
      const fn = vi.fn().mockRejectedValue(err);
      const onError = vi.fn().mockReturnValue({ recovered: true, fallback: 'default-value' });
      const handler = EventHandler.wrap(fn, { onError });

      const result = await handler.handle(event);

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(err, event);
      expect(result).toEqual({ recovered: true, fallback: 'default-value' });
    });

    it('supports asynchronous recovery in onError', async () => {
      const err = new Error('Service down');
      const fn = vi.fn().mockRejectedValue(err);
      const onError = vi.fn().mockResolvedValue('async-recovered-state');
      const handler = EventHandler.wrap(fn, { onError });

      const result = await handler.handle({});
      expect(result).toBe('async-recovered-state');
    });

    it('propagates error when onError itself throws', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('primary failure'));
      const onError = vi.fn(() => {
        throw new Error('onError handler failed');
      });
      const handler = EventHandler.wrap(fn, { onError });

      await expect(handler.handle({})).rejects.toThrow('onError handler failed');
    });
  });

  describe('Timeout behavior contract', () => {
    it('bypasses timer setup entirely when timeout <= 0', async () => {
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
      const fn = vi.fn().mockResolvedValue('immediate');
      const handler = EventHandler.wrap(fn, { timeout: 0 });

      const result = await handler.handle({ eventType: 'FAST' });

      expect(result).toBe('immediate');
      expect(setTimeoutSpy).not.toHaveBeenCalled();
      setTimeoutSpy.mockRestore();
    });

    it('rejects with descriptive error containing handler name and timeout ms', async () => {
      const slowFn = vi.fn(() => new Promise((resolve) => setTimeout(resolve, 500)));
      const handler = EventHandler.wrap(slowFn, { name: 'slowReporter', timeout: 50 });

      await expect(handler.handle({})).rejects.toThrow('Handler "slowReporter" timed out after 50ms');
    });

    it('delegates timeout rejection to onError when onError is provided', async () => {
      const slowFn = vi.fn(() => new Promise((resolve) => setTimeout(resolve, 500)));
      const onError = vi.fn().mockReturnValue('timed-out-fallback');
      const handler = EventHandler.wrap(slowFn, { name: 'slowReporter', timeout: 30, onError });

      const result = await handler.handle({ id: 'evt-timeout' });

      expect(result).toBe('timed-out-fallback');
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('timed out after 30ms') }),
        { id: 'evt-timeout' },
      );
    });

    it('cleans up timeout timer on resolution', async () => {
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
      const handler = EventHandler.wrap(vi.fn().mockResolvedValue('done'), { timeout: 5000 });

      try {
        await handler.handle({});
        expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
      } finally {
        clearTimeoutSpy.mockRestore();
      }
    });

    it('cleans up timeout timer on handler rejection', async () => {
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
      const handler = EventHandler.wrap(vi.fn().mockRejectedValue(new Error('fail')), { timeout: 5000 });

      try {
        await expect(handler.handle({})).rejects.toThrow('fail');
        expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
      } finally {
        clearTimeoutSpy.mockRestore();
      }
    });
  });

  describe('OpenTelemetry distributed tracing contract', () => {
    it('starts span with event.metadata.eventType and handler name', async () => {
      const fn = vi.fn().mockResolvedValue('ok');
      const handler = EventHandler.wrap(fn, { name: 'dispatchHandler' });
      const event = { metadata: { eventType: 'DRIVER_DISPATCHED' } };

      await handler.handle(event);

      expect(spanFactory.startEventHandlerSpan).toHaveBeenCalledWith('DRIVER_DISPATCHED', 'dispatchHandler');
    });

    it('falls back to event.eventType if event.metadata is not present', async () => {
      const fn = vi.fn().mockResolvedValue('ok');
      const handler = EventHandler.wrap(fn, { name: 'legacyHandler' });
      const event = { eventType: 'LEGACY_PING' };

      await handler.handle(event);

      expect(spanFactory.startEventHandlerSpan).toHaveBeenCalledWith('LEGACY_PING', 'legacyHandler');
    });

    it('falls back to "unknown" when event has no eventType and no metadata', async () => {
      const fn = vi.fn().mockResolvedValue('ok');
      const handler = EventHandler.wrap(fn, { name: 'genericHandler' });

      await handler.handle({});
      expect(spanFactory.startEventHandlerSpan).toHaveBeenCalledWith('unknown', 'genericHandler');

      await handler.handle();
      expect(spanFactory.startEventHandlerSpan).toHaveBeenCalledWith('unknown', 'genericHandler');
    });

    it('extracts parent trace context when traceContext is present in event metadata', async () => {
      const fn = vi.fn().mockResolvedValue('ok');
      const handler = EventHandler.wrap(fn, { name: 'traceHandler' });
      const event = { metadata: { traceContext: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' } };

      await handler.handle(event);

      expect(ContextPropagator.extractFromEventPayload).toHaveBeenCalledWith(event);
      expect(trace.setSpan).toHaveBeenCalledWith(
        { parentTrace: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' },
        mockSpan,
      );
    });

    it('falls back to context.active() when traceContext is absent', async () => {
      const fn = vi.fn().mockResolvedValue('ok');
      const handler = EventHandler.wrap(fn, { name: 'noTraceHandler' });

      await handler.handle({ payload: 'no-meta' });

      expect(context.active).toHaveBeenCalled();
      expect(trace.setSpan).toHaveBeenCalledWith({ contextId: 'active-context' }, mockSpan);
    });

    it('marks span OK and ends span on success', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      const handler = EventHandler.wrap(fn, { name: 'okHandler' });

      await handler.handle({ eventType: 'ORDER_PAID' });

      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
      expect(mockSpan.end).toHaveBeenCalledTimes(1);
    });

    it('records error on span and ends span when handler throws without onError', async () => {
      const err = new Error('Unhandled exception');
      const fn = vi.fn().mockRejectedValue(err);
      const handler = EventHandler.wrap(fn, { name: 'errorHandler' });

      await expect(handler.handle({})).rejects.toThrow('Unhandled exception');

      expect(spanFactory.recordError).toHaveBeenCalledWith(mockSpan, err);
      expect(mockSpan.end).toHaveBeenCalledTimes(1);
    });

    it('records error on span and ends span even when onError recovers the failure', async () => {
      const err = new Error('Recovered failure');
      const fn = vi.fn().mockRejectedValue(err);
      const onError = vi.fn().mockReturnValue('recovered');
      const handler = EventHandler.wrap(fn, { name: 'recoveringHandler', onError });

      const result = await handler.handle({});
      expect(result).toBe('recovered');

      expect(spanFactory.recordError).toHaveBeenCalledWith(mockSpan, err);
      expect(mockSpan.end).toHaveBeenCalledTimes(1);
    });
  });
});
