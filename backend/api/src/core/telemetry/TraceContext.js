import { context, trace, propagation, ROOT_CONTEXT } from '@opentelemetry/api';

const TRACE_PARENT_HEADER = 'traceparent';
const TRACE_STATE_HEADER = 'tracestate';
const BAGGAGE_PREFIX = 'baggage';

export class TraceContext {
  static injectIntoHeaders(headers = {}) {
    const ctx = context.active();
    propagation.inject(ctx, headers);
    return headers;
  }

  static extractFromHeaders(headers = {}) {
    return propagation.extract(ROOT_CONTEXT, headers);
  }

  static injectIntoMessage(message = {}) {
    const headers = message.headers || {};
    const ctx = context.active();
    propagation.inject(ctx, headers);
    return { ...message, headers };
  }

  static extractFromMessage(message = {}) {
    const headers = message.headers || {};
    return propagation.extract(ROOT_CONTEXT, headers);
  }

  static serialize() {
    const headers = {};
    const ctx = context.active();
    propagation.inject(ctx, headers);
    return headers;
  }

  static deserialize(serialized) {
    if (!serialized || typeof serialized !== 'object') {
      return ROOT_CONTEXT;
    }
    return propagation.extract(ROOT_CONTEXT, serialized);
  }

  static runWithContext(serializedContext, fn) {
    const ctx = TraceContext.deserialize(serializedContext);
    return context.with(ctx, fn);
  }

  static getActiveSpan() {
    return trace.getSpan(context.active());
  }

  static getActiveTraceId() {
    const span = TraceContext.getActiveSpan();
    return span?.spanContext()?.traceId || null;
  }

  static getActiveSpanId() {
    const span = TraceContext.getActiveSpan();
    return span?.spanContext()?.spanId || null;
  }

  static getActiveSpanContext() {
    const span = TraceContext.getActiveSpan();
    return span?.spanContext() || null;
  }

  static isValid() {
    const spanCtx = TraceContext.getActiveSpanContext();
    return spanCtx && spanCtx.traceId && spanCtx.traceId !== '00000000000000000000000000000000';
  }

  static getCorrelationId() {
    const span = TraceContext.getActiveSpan();
    if (span) {
      const attrs = span.attributes;
      return attrs?.['correlation.id'] || attrs?.['correlation_id'] || null;
    }
    return null;
  }

  static currentContext() {
    return context.active();
  }
}
