import { describe, it, expect, beforeAll } from 'vitest';
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  context,
  propagation,
  ROOT_CONTEXT,
} from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { ContextPropagator } from '../../src/core/telemetry/ContextPropagator.js';

class TestContextManager {
  constructor() {
    this._als = new AsyncLocalStorage();
  }
  active() { return this._als.getStore() ?? ROOT_CONTEXT; }
  with(ctx, fn, thisArg, ...args) { return this._als.run(ctx, () => fn.call(thisArg, ...args)); }
  bind(ctx, target) {
    return typeof target === 'function'
      ? (...args) => this.with(ctx, () => target(...args))
      : target;
  }
  enable() { return this; }
  disable() { this._als.disable(); return this; }
}

const TRACE_ID = '0af7651916cd43dd8448eb211c80319c';
const SPAN_ID = 'b7ad6b7169203331';
const TRACEPARENT = `00-${TRACE_ID}-${SPAN_ID}-01`;

beforeAll(() => {
  // Install a minimal AsyncLocalStorage context manager so context.active()
  // returns the currently active test span instead of always ROOT_CONTEXT.
  const manager = new TestContextManager();
  context.setGlobalContextManager(manager);
});

describe('ContextPropagator', () => {
  describe('injectIntoKafkaHeaders', () => {
    it('returns the headers object after injection', () => {
      const headers = {};
      const result = ContextPropagator.injectIntoKafkaHeaders(headers);
      expect(result).toBe(headers);
    });
  });

  describe('extractFromKafkaHeaders', () => {
    it('returns ROOT_CONTEXT for empty headers', () => {
      const ctx = ContextPropagator.extractFromKafkaHeaders({});
      expect(ctx).toBe(ROOT_CONTEXT);
    });

    it('returns a context for valid traceparent header', () => {
      const headers = { traceparent: TRACEPARENT };
      const ctx = ContextPropagator.extractFromKafkaHeaders(headers);
      expect(ctx).toBeDefined();
    });
  });

  describe('injectIntoKafkaMessage', () => {
    it('returns a new message object with headers', () => {
      const msg = { payload: { foo: 'bar' } };
      const result = ContextPropagator.injectIntoKafkaMessage(msg);
      expect(result).not.toBe(msg);
      expect(result.payload).toEqual({ foo: 'bar' });
      expect(result.headers).toBeDefined();
    });

    it('creates headers when message has none', () => {
      const msg = {};
      const result = ContextPropagator.injectIntoKafkaMessage(msg);
      expect(result.headers).toBeDefined();
    });
  });

  describe('extractFromKafkaMessage', () => {
    it('returns ROOT_CONTEXT for empty message', () => {
      const ctx = ContextPropagator.extractFromKafkaMessage({});
      expect(ctx).toBe(ROOT_CONTEXT);
    });

    it('returns ROOT_CONTEXT for message with no headers', () => {
      const ctx = ContextPropagator.extractFromKafkaMessage({ payload: 'data' });
      expect(ctx).toBe(ROOT_CONTEXT);
    });

    it('extracts from string header values', () => {
      const ctx = ContextPropagator.extractFromKafkaMessage({ headers: { traceparent: TRACEPARENT } });
      expect(ctx).toBeDefined();
    });

    it('extracts from Buffer header values', () => {
      const buf = Buffer.from(TRACEPARENT);
      const ctx = ContextPropagator.extractFromKafkaMessage({ headers: { traceparent: buf } });
      expect(ctx).toBeDefined();
    });

    it('extracts from numeric header values via String coercion', () => {
      // numeric values get String()'d in extractFromKafkaMessage
      const ctx = ContextPropagator.extractFromKafkaMessage({ headers: { traceparent: 42 } });
      expect(ctx).toBe(ROOT_CONTEXT);  // String(42) !== valid traceparent
    });
  });

  describe('injectIntoHttpHeaders', () => {
    it('returns the headers object after injection', () => {
      const headers = {};
      const result = ContextPropagator.injectIntoHttpHeaders(headers);
      expect(result).toBe(headers);
    });
  });

  describe('extractFromHttpHeaders', () => {
    it('extracts trace context from valid headers', () => {
      const ctx = ContextPropagator.extractFromHttpHeaders({ traceparent: TRACEPARENT });
      expect(ctx).toBeDefined();
    });

    it('returns ROOT_CONTEXT for empty headers', () => {
      const ctx = ContextPropagator.extractFromHttpHeaders({});
      expect(ctx).toBe(ROOT_CONTEXT);
    });
  });

  describe('injectIntoEventPayload', () => {
    it('returns null/undefined event unchanged', () => {
      expect(ContextPropagator.injectIntoEventPayload(null)).toBe(null);
      expect(ContextPropagator.injectIntoEventPayload(undefined)).toBe(undefined);
    });

    it('adds traceContext to event without metadata', () => {
      const event = { type: 'ORDER_CREATED', data: { id: '123' } };
      const result = ContextPropagator.injectIntoEventPayload(event);
      expect(result.metadata.traceContext).toBeDefined();
      expect(result.type).toBe('ORDER_CREATED');
    });

    it('merges traceContext into existing metadata', () => {
      const event = { type: 'ORDER_CREATED', metadata: { userId: 'u1' } };
      const result = ContextPropagator.injectIntoEventPayload(event);
      expect(result.metadata.userId).toBe('u1');
      expect(result.metadata.traceContext).toBeDefined();
    });

    it('does not mutate the original event', () => {
      const event = { type: 'ORDER_CREATED' };
      const result = ContextPropagator.injectIntoEventPayload(event);
      expect(result).not.toBe(event);
      expect(event.metadata).toBeUndefined();
    });
  });

  describe('extractFromEventPayload', () => {
    it('returns ROOT_CONTEXT for event without metadata', () => {
      const ctx = ContextPropagator.extractFromEventPayload({ type: 'ORDER_CREATED' });
      expect(ctx).toBe(ROOT_CONTEXT);
    });

    it('returns ROOT_CONTEXT for event with empty metadata', () => {
      const ctx = ContextPropagator.extractFromEventPayload({ metadata: {} });
      expect(ctx).toBe(ROOT_CONTEXT);
    });
  });

  describe('runWithExtractedContext', () => {
    it('runs function with extracted context', () => {
      let ran = false;
      ContextPropagator.runWithExtractedContext({ traceparent: TRACEPARENT }, () => {
        ran = true;
      });
      expect(ran).toBe(true);
    });
  });

  describe('snapshot / restore', () => {
    it('snapshot returns an object', () => {
      const snap = ContextPropagator.snapshot();
      expect(typeof snap).toBe('object');
    });

    it('restore runs function with snapshot context', () => {
      let value = null;
      ContextPropagator.restore({}, () => { value = 42; });
      expect(value).toBe(42);
    });
  });

  describe('propagateAcrossAsync', () => {
    it('returns carrier with _traceSnapshot', () => {
      const { carrier } = ContextPropagator.propagateAcrossAsync({ existing: 'val' });
      expect(carrier.existing).toBe('val');
      expect(carrier._traceSnapshot).toBeDefined();
    });

    it('restore function runs with snapshot context', () => {
      const { restore } = ContextPropagator.propagateAcrossAsync({});
      let val = null;
      restore(() => { val = 'restored'; });
      expect(val).toBe('restored');
    });
  });
});
