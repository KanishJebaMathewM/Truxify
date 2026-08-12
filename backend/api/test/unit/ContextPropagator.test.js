import { describe, it, expect, beforeAll } from 'vitest';
import { AsyncLocalStorage } from 'node:async_hooks';
import { context, trace, propagation, ROOT_CONTEXT } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';

import { ContextPropagator } from '../../src/core/telemetry/ContextPropagator.js';

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const SPAN_ID = '00f067aa0ba902b7';
const TRACEPARENT = `00-${TRACE_ID}-${SPAN_ID}-01`;

/**
 * The API package's default context manager is a no-op whose active() always
 * returns ROOT_CONTEXT, which would make every context.with() assertion below
 * vacuous. @opentelemetry/context-async-hooks is not a dependency of this
 * package, so this is that manager in miniature.
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

const activeSpanContext = {
  traceId: TRACE_ID,
  spanId: SPAN_ID,
  traceFlags: 1,
  isRemote: false,
};

/** Runs `fn` with a fixed span context active. */
const withActiveTrace = (fn) =>
  context.with(trace.setSpanContext(ROOT_CONTEXT, activeSpanContext), fn);

describe('ContextPropagator', () => {
  beforeAll(() => {
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());
    context.setGlobalContextManager(new TestContextManager());
  });

  describe('Kafka headers', () => {
    it('injects a traceparent into the supplied header bag', () => {
      const headers = withActiveTrace(() =>
        ContextPropagator.injectIntoKafkaHeaders({}),
      );

      expect(headers.traceparent).toBe(TRACEPARENT);
    });

    it('mutates the caller-supplied bag in place', () => {
      const carrier = { 'x-partition-key': 'driver-1' };

      const returned = withActiveTrace(() =>
        ContextPropagator.injectIntoKafkaHeaders(carrier),
      );

      expect(returned).toBe(carrier);
      expect(carrier['x-partition-key']).toBe('driver-1');
    });

    it('injects nothing when no span is active', () => {
      expect(ContextPropagator.injectIntoKafkaHeaders({})).toEqual({});
    });

    it('extracts a remote span context back out', () => {
      const ctx = ContextPropagator.extractFromKafkaHeaders({
        traceparent: TRACEPARENT,
      });

      expect(trace.getSpanContext(ctx)).toMatchObject({
        traceId: TRACE_ID,
        spanId: SPAN_ID,
        isRemote: true,
      });
    });

    it('extracts nothing from an empty header bag', () => {
      const ctx = ContextPropagator.extractFromKafkaHeaders({});
      expect(trace.getSpanContext(ctx)).toBeUndefined();
    });
  });

  describe('injectIntoKafkaMessage()', () => {
    it('creates a headers bag on a message that has none', () => {
      const enriched = withActiveTrace(() =>
        ContextPropagator.injectIntoKafkaMessage({ key: 'k', value: 'v' }),
      );

      expect(enriched.headers.traceparent).toBe(TRACEPARENT);
      expect(enriched.key).toBe('k');
      expect(enriched.value).toBe('v');
    });

    it('does not mutate the caller message', () => {
      const message = { value: 'v' };

      withActiveTrace(() => ContextPropagator.injectIntoKafkaMessage(message));

      expect(message.headers).toBeUndefined();
    });

    it('keeps existing headers', () => {
      const enriched = withActiveTrace(() =>
        ContextPropagator.injectIntoKafkaMessage({ headers: { origin: 'api' } }),
      );

      expect(enriched.headers.origin).toBe('api');
      expect(enriched.headers.traceparent).toBe(TRACEPARENT);
    });

    it('shares the headers object with the caller when one was supplied', () => {
      // The shallow copy carries the same headers reference, so injection is
      // visible through the original message. Pinned because it is surprising.
      const message = { headers: { origin: 'api' } };

      withActiveTrace(() => ContextPropagator.injectIntoKafkaMessage(message));

      expect(message.headers.traceparent).toBe(TRACEPARENT);
    });
  });

  describe('extractFromKafkaMessage()', () => {
    it('decodes Buffer header values, as kafkajs delivers them', () => {
      const ctx = ContextPropagator.extractFromKafkaMessage({
        headers: { traceparent: Buffer.from(TRACEPARENT, 'utf-8') },
      });

      expect(trace.getSpanContext(ctx)).toMatchObject({ traceId: TRACE_ID });
    });

    it('passes string header values through unchanged', () => {
      const ctx = ContextPropagator.extractFromKafkaMessage({
        headers: { traceparent: TRACEPARENT },
      });

      expect(trace.getSpanContext(ctx)).toMatchObject({ spanId: SPAN_ID });
    });

    it('stringifies other non-null header values', () => {
      const ctx = ContextPropagator.extractFromKafkaMessage({
        headers: { traceparent: TRACEPARENT, retries: 3, replay: false },
      });

      expect(trace.getSpanContext(ctx)).toMatchObject({ traceId: TRACE_ID });
    });

    it('drops null and undefined header values rather than stringifying them', () => {
      // 'null'/'undefined' strings reaching the propagator would be worse than
      // an absent key, so the normaliser skips them.
      const ctx = ContextPropagator.extractFromKafkaMessage({
        headers: { traceparent: null, tracestate: undefined },
      });

      expect(trace.getSpanContext(ctx)).toBeUndefined();
    });

    it.each([
      ['a message with no headers', {}],
      ['null', null],
      ['undefined', undefined],
    ])('returns a span-less context for %s', (_label, message) => {
      const ctx = ContextPropagator.extractFromKafkaMessage(message);
      expect(trace.getSpanContext(ctx)).toBeUndefined();
    });

    it('never inherits the ambient span', () => {
      const ctx = withActiveTrace(() =>
        ContextPropagator.extractFromKafkaMessage({ headers: {} }),
      );

      expect(trace.getSpanContext(ctx)).toBeUndefined();
    });
  });

  describe('HTTP headers', () => {
    it('round-trips through inject and extract', () => {
      const headers = withActiveTrace(() =>
        ContextPropagator.injectIntoHttpHeaders({}),
      );

      const ctx = ContextPropagator.extractFromHttpHeaders(headers);

      expect(trace.getSpanContext(ctx)).toMatchObject({
        traceId: TRACE_ID,
        spanId: SPAN_ID,
      });
    });

    it('leaves unrelated headers alone', () => {
      const headers = withActiveTrace(() =>
        ContextPropagator.injectIntoHttpHeaders({ 'content-type': 'application/json' }),
      );

      expect(headers['content-type']).toBe('application/json');
    });
  });

  describe('injectIntoEventPayload()', () => {
    it('attaches the serialized context under metadata.traceContext', () => {
      const enriched = withActiveTrace(() =>
        ContextPropagator.injectIntoEventPayload({ type: 'order.created' }),
      );

      expect(enriched.metadata.traceContext.traceparent).toBe(TRACEPARENT);
      expect(enriched.type).toBe('order.created');
    });

    it('merges into existing metadata instead of replacing it', () => {
      const enriched = withActiveTrace(() =>
        ContextPropagator.injectIntoEventPayload({
          metadata: { source: 'api', version: 2 },
        }),
      );

      expect(enriched.metadata).toMatchObject({ source: 'api', version: 2 });
      expect(enriched.metadata.traceContext.traceparent).toBe(TRACEPARENT);
    });

    it('does not mutate the caller event', () => {
      const event = { type: 'order.created' };

      withActiveTrace(() => ContextPropagator.injectIntoEventPayload(event));

      expect(event.metadata).toBeUndefined();
    });

    it('overwrites non-object metadata rather than spreading it', () => {
      const enriched = withActiveTrace(() =>
        ContextPropagator.injectIntoEventPayload({ metadata: 'not-an-object' }),
      );

      expect(enriched.metadata).toEqual({ traceContext: { traceparent: TRACEPARENT } });
    });

    it('treats null metadata as absent', () => {
      const enriched = withActiveTrace(() =>
        ContextPropagator.injectIntoEventPayload({ metadata: null }),
      );

      expect(enriched.metadata.traceContext.traceparent).toBe(TRACEPARENT);
    });

    it('still writes an (empty) traceContext when no span is active', () => {
      const enriched = ContextPropagator.injectIntoEventPayload({ type: 'x' });
      expect(enriched.metadata.traceContext).toEqual({});
    });

    it.each([
      ['null', null],
      ['undefined', undefined],
    ])('returns %s unchanged', (_label, event) => {
      expect(ContextPropagator.injectIntoEventPayload(event)).toBe(event);
    });
  });

  describe('extractFromEventPayload()', () => {
    it('round-trips an injected payload', () => {
      const enriched = withActiveTrace(() =>
        ContextPropagator.injectIntoEventPayload({ type: 'order.created' }),
      );

      const ctx = ContextPropagator.extractFromEventPayload(enriched);

      expect(trace.getSpanContext(ctx)).toMatchObject({ traceId: TRACE_ID });
    });

    it.each([
      ['no metadata', { type: 'x' }],
      ['metadata without traceContext', { metadata: { source: 'api' } }],
      ['null', null],
      ['undefined', undefined],
    ])('falls back to ROOT_CONTEXT for %s', (_label, event) => {
      expect(ContextPropagator.extractFromEventPayload(event)).toBe(ROOT_CONTEXT);
    });
  });

  describe('runWithExtractedContext()', () => {
    it('makes the carrier context active inside the callback', () => {
      const observed = ContextPropagator.runWithExtractedContext(
        { traceparent: TRACEPARENT },
        () => trace.getSpanContext(context.active()).traceId,
      );

      expect(observed).toBe(TRACE_ID);
    });

    it('returns the callback result', () => {
      expect(ContextPropagator.runWithExtractedContext({}, () => 'done')).toBe('done');
    });

    it('unwinds the context afterwards', () => {
      ContextPropagator.runWithExtractedContext({ traceparent: TRACEPARENT }, () => null);
      expect(context.active()).toBe(ROOT_CONTEXT);
    });

    it('propagates a throwing callback', () => {
      expect(() =>
        ContextPropagator.runWithExtractedContext({ traceparent: TRACEPARENT }, () => {
          throw new Error('handler failed');
        }),
      ).toThrow('handler failed');
    });
  });

  describe('snapshot() / restore()', () => {
    it('carries the trace across an async boundary the SDK cannot see', async () => {
      const snapshot = withActiveTrace(() => ContextPropagator.snapshot());

      // Simulate the work resuming on a detached tick, outside any context.
      await new Promise((resolve) => setImmediate(resolve));

      const observed = ContextPropagator.restore(snapshot, () =>
        trace.getSpanContext(context.active()).traceId,
      );

      expect(observed).toBe(TRACE_ID);
    });

    it('snapshot() is empty with no active span', () => {
      expect(ContextPropagator.snapshot()).toEqual({});
    });

    it('restore() with an empty snapshot runs at the root context', () => {
      const observed = ContextPropagator.restore({}, () => context.active());
      expect(trace.getSpanContext(observed)).toBeUndefined();
    });
  });

  describe('propagateAcrossAsync()', () => {
    it('returns a carrier stamped with the snapshot plus a restore()', () => {
      const { carrier, restore } = withActiveTrace(() =>
        ContextPropagator.propagateAcrossAsync({ jobId: 'job-1' }),
      );

      expect(carrier.jobId).toBe('job-1');
      expect(carrier._traceSnapshot.traceparent).toBe(TRACEPARENT);
      expect(restore(() => trace.getSpanContext(context.active()).traceId)).toBe(TRACE_ID);
    });

    it('does not mutate the caller carrier', () => {
      const carrier = { jobId: 'job-1' };

      withActiveTrace(() => ContextPropagator.propagateAcrossAsync(carrier));

      expect(carrier._traceSnapshot).toBeUndefined();
    });

    it('works with no carrier argument', () => {
      const { carrier } = withActiveTrace(() =>
        ContextPropagator.propagateAcrossAsync(),
      );

      expect(Object.keys(carrier)).toEqual(['_traceSnapshot']);
    });

    it('restore() still runs the callback when nothing was active', () => {
      const { restore } = ContextPropagator.propagateAcrossAsync();
      expect(restore(() => 'ran')).toBe('ran');
    });
  });
});
