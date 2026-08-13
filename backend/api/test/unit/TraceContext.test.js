import { describe, it, expect, beforeAll } from 'vitest';
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  context,
  trace,
  propagation,
  ROOT_CONTEXT,
} from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';

import { TraceContext } from '../../src/core/telemetry/TraceContext.js';

/**
 * The API package ships a no-op context manager, so `context.active()` would
 * always be ROOT_CONTEXT and none of these assertions would mean anything.
 * `@opentelemetry/context-async-hooks` is not a dependency of this package, so
 * this is the same AsyncLocalStorage-backed manager in miniature.
 */
class TestContextManager {
  constructor() {
    this._als = new AsyncLocalStorage();
  }

  active() {
    return this._als.getStore() ?? ROOT_CONTEXT;
  }

  with(ctx, fn, thisArg, ...args) {
    return this._als.run(ctx, () => fn.call(thisArg, ...args));
  }

  bind(ctx, target) {
    return typeof target === 'function'
      ? (...args) => this.with(ctx, () => target(...args))
      : target;
  }

  enable() {
    return this;
  }

  disable() {
    this._als.disable();
    return this;
  }
}

const TRACE_ID = '0af7651916cd43dd8448eb211c80319c';
const SPAN_ID = 'b7ad6b7169203331';
const TRACEPARENT = `00-${TRACE_ID}-${SPAN_ID}-01`;
const INVALID_TRACE_ID = '00000000000000000000000000000000';

/**
 * Builds a context carrying a non-recording span with a fixed span context, so
 * assertions can pin exact trace/span ids without standing up an SDK exporter.
 */
const contextWithSpanContext = (spanContext) =>
  trace.setSpanContext(ROOT_CONTEXT, spanContext);

const validSpanContext = {
  traceId: TRACE_ID,
  spanId: SPAN_ID,
  traceFlags: 1,
  isRemote: false,
};

describe('TraceContext', () => {
  beforeAll(() => {
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());
    context.setGlobalContextManager(new TestContextManager());
  });

  describe('injectIntoHeaders()', () => {
    it('writes a traceparent for the active span context', () => {
      const headers = context.with(contextWithSpanContext(validSpanContext), () =>
        TraceContext.injectIntoHeaders(),
      );

      expect(headers.traceparent).toBe(TRACEPARENT);
    });

    it('mutates and returns the caller-supplied headers object', () => {
      const carrier = { authorization: 'Bearer token' };

      const returned = context.with(contextWithSpanContext(validSpanContext), () =>
        TraceContext.injectIntoHeaders(carrier),
      );

      expect(returned).toBe(carrier);
      expect(carrier.authorization).toBe('Bearer token');
      expect(carrier.traceparent).toBe(TRACEPARENT);
    });

    it('leaves headers untouched when there is no active span', () => {
      const headers = TraceContext.injectIntoHeaders({});
      expect(headers).toEqual({});
    });
  });

  describe('extractFromHeaders()', () => {
    it('rebuilds the remote span context from a traceparent', () => {
      const ctx = TraceContext.extractFromHeaders({ traceparent: TRACEPARENT });
      const spanContext = trace.getSpanContext(ctx);

      expect(spanContext.traceId).toBe(TRACE_ID);
      expect(spanContext.spanId).toBe(SPAN_ID);
      expect(spanContext.isRemote).toBe(true);
    });

    it('returns a context with no span for an empty carrier', () => {
      expect(trace.getSpanContext(TraceContext.extractFromHeaders({}))).toBeUndefined();
    });

    it('ignores a malformed traceparent instead of throwing', () => {
      const ctx = TraceContext.extractFromHeaders({ traceparent: 'not-a-traceparent' });
      expect(trace.getSpanContext(ctx)).toBeUndefined();
    });

    it('does not read the ambient context', () => {
      const ctx = context.with(contextWithSpanContext(validSpanContext), () =>
        TraceContext.extractFromHeaders({}),
      );

      expect(trace.getSpanContext(ctx)).toBeUndefined();
    });
  });

  describe('injectIntoMessage()', () => {
    it('adds a headers bag to a message that has none', () => {
      const message = { value: 'payload' };

      const enriched = context.with(contextWithSpanContext(validSpanContext), () =>
        TraceContext.injectIntoMessage(message),
      );

      expect(enriched.value).toBe('payload');
      expect(enriched.headers.traceparent).toBe(TRACEPARENT);
    });

    it('returns a new message object rather than replacing the original', () => {
      const message = { value: 'payload' };

      const enriched = context.with(contextWithSpanContext(validSpanContext), () =>
        TraceContext.injectIntoMessage(message),
      );

      expect(enriched).not.toBe(message);
      expect(message.value).toBe('payload');
    });

    it('preserves existing headers alongside the injected traceparent', () => {
      const message = { headers: { key: 'existing' } };

      const enriched = context.with(contextWithSpanContext(validSpanContext), () =>
        TraceContext.injectIntoMessage(message),
      );

      expect(enriched.headers.key).toBe('existing');
      expect(enriched.headers.traceparent).toBe(TRACEPARENT);
    });

    it('tolerates being called with no message at all', () => {
      const enriched = TraceContext.injectIntoMessage();
      expect(enriched.headers).toEqual({});
    });
  });

  describe('extractFromMessage()', () => {
    it('reads the traceparent out of message headers', () => {
      const ctx = TraceContext.extractFromMessage({
        headers: { traceparent: TRACEPARENT },
      });

      expect(trace.getSpanContext(ctx).traceId).toBe(TRACE_ID);
    });

    it('returns a span-less context for a message without headers', () => {
      expect(trace.getSpanContext(TraceContext.extractFromMessage({}))).toBeUndefined();
    });

    it('tolerates being called with no message at all', () => {
      expect(trace.getSpanContext(TraceContext.extractFromMessage())).toBeUndefined();
    });
  });

  describe('serialize() / deserialize()', () => {
    it('round-trips the active span context through a plain object', () => {
      const serialized = context.with(contextWithSpanContext(validSpanContext), () =>
        TraceContext.serialize(),
      );

      const restored = trace.getSpanContext(TraceContext.deserialize(serialized));

      expect(restored.traceId).toBe(TRACE_ID);
      expect(restored.spanId).toBe(SPAN_ID);
    });

    it('serialize() yields an empty object with no active span', () => {
      expect(TraceContext.serialize()).toEqual({});
    });

    it.each([
      ['null', null],
      ['undefined', undefined],
      ['a string', 'traceparent'],
      ['a number', 42],
    ])('deserialize() falls back to ROOT_CONTEXT for %s', (_label, input) => {
      expect(TraceContext.deserialize(input)).toBe(ROOT_CONTEXT);
    });

    it('deserialize() returns a span-less context for an empty object', () => {
      const ctx = TraceContext.deserialize({});
      expect(trace.getSpanContext(ctx)).toBeUndefined();
    });
  });

  describe('runWithContext()', () => {
    it('makes the deserialized span context active inside the callback', () => {
      const serialized = { traceparent: TRACEPARENT };

      const observed = TraceContext.runWithContext(serialized, () =>
        TraceContext.getActiveTraceId(),
      );

      expect(observed).toBe(TRACE_ID);
    });

    it('returns the callback result', () => {
      expect(TraceContext.runWithContext({}, () => 'result')).toBe('result');
    });

    it('restores the previous context after the callback finishes', () => {
      TraceContext.runWithContext({ traceparent: TRACEPARENT }, () => undefined);
      expect(TraceContext.getActiveTraceId()).toBeNull();
    });

    it('propagates a throwing callback', () => {
      expect(() =>
        TraceContext.runWithContext({}, () => {
          throw new Error('boom');
        }),
      ).toThrow('boom');
    });
  });

  describe('active span accessors', () => {
    it('getActiveSpan() returns undefined outside any span', () => {
      expect(TraceContext.getActiveSpan()).toBeUndefined();
    });

    it('getActiveTraceId() and getActiveSpanId() return null outside any span', () => {
      expect(TraceContext.getActiveTraceId()).toBeNull();
      expect(TraceContext.getActiveSpanId()).toBeNull();
    });

    it('getActiveSpanContext() returns null outside any span', () => {
      expect(TraceContext.getActiveSpanContext()).toBeNull();
    });

    it('reports the ids of the active span', () => {
      context.with(contextWithSpanContext(validSpanContext), () => {
        expect(TraceContext.getActiveTraceId()).toBe(TRACE_ID);
        expect(TraceContext.getActiveSpanId()).toBe(SPAN_ID);
        expect(TraceContext.getActiveSpanContext()).toMatchObject({
          traceId: TRACE_ID,
          spanId: SPAN_ID,
        });
      });
    });
  });

  describe('isValid()', () => {
    it('is falsy with no active span', () => {
      expect(TraceContext.isValid()).toBeFalsy();
    });

    it('is true for a real trace id', () => {
      context.with(contextWithSpanContext(validSpanContext), () => {
        expect(TraceContext.isValid()).toBe(true);
      });
    });

    it('rejects the all-zero invalid trace id', () => {
      const ctx = contextWithSpanContext({
        ...validSpanContext,
        traceId: INVALID_TRACE_ID,
      });

      context.with(ctx, () => {
        expect(TraceContext.isValid()).toBe(false);
      });
    });
  });

  describe('getCorrelationId()', () => {
    /** Minimal span stand-in — only `attributes` is read by getCorrelationId(). */
    const spanWithAttributes = (attributes) => ({
      attributes,
      spanContext: () => validSpanContext,
      setAttribute() {},
      setAttributes() {},
      addEvent() {},
      setStatus() {},
      updateName() {},
      end() {},
      isRecording: () => true,
      recordException() {},
    });

    const runWithSpan = (span, fn) =>
      context.with(trace.setSpan(ROOT_CONTEXT, span), fn);

    it('returns null with no active span', () => {
      expect(TraceContext.getCorrelationId()).toBeNull();
    });

    it('prefers the dotted correlation.id attribute', () => {
      const span = spanWithAttributes({
        'correlation.id': 'dotted',
        correlation_id: 'underscored',
      });

      runWithSpan(span, () => {
        expect(TraceContext.getCorrelationId()).toBe('dotted');
      });
    });

    it('falls back to the underscored correlation_id attribute', () => {
      const span = spanWithAttributes({ correlation_id: 'underscored' });

      runWithSpan(span, () => {
        expect(TraceContext.getCorrelationId()).toBe('underscored');
      });
    });

    it('returns null when the span carries no correlation attribute', () => {
      runWithSpan(spanWithAttributes({ 'http.method': 'GET' }), () => {
        expect(TraceContext.getCorrelationId()).toBeNull();
      });
    });

    it('returns null when the span exposes no attributes bag', () => {
      const span = spanWithAttributes(undefined);

      runWithSpan(span, () => {
        expect(TraceContext.getCorrelationId()).toBeNull();
      });
    });
  });

  describe('currentContext()', () => {
    it('returns ROOT_CONTEXT at the top level', () => {
      expect(TraceContext.currentContext()).toBe(ROOT_CONTEXT);
    });

    it('returns the context entered via context.with()', () => {
      const entered = contextWithSpanContext(validSpanContext);

      context.with(entered, () => {
        expect(TraceContext.currentContext()).toBe(entered);
      });
    });
  });
});
