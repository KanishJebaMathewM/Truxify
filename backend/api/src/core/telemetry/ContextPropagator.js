import { context, propagation, ROOT_CONTEXT } from '@opentelemetry/api';
import { TraceContext } from './TraceContext.js';

export class ContextPropagator {
  static injectIntoKafkaHeaders(headers = {}) {
    return TraceContext.injectIntoHeaders(headers);
  }

  static extractFromKafkaHeaders(headers = {}) {
    return TraceContext.extractFromHeaders(headers);
  }

  static injectIntoKafkaMessage(message) {
    const enriched = { ...message };
    if (!enriched.headers) {
      enriched.headers = {};
    }
    propagation.inject(context.active(), enriched.headers);
    return enriched;
  }

  static extractFromKafkaMessage(message) {
    const headers = message?.headers || {};
    const normalized = {};
    for (const [key, value] of Object.entries(headers)) {
      if (Buffer.isBuffer(value)) {
        normalized[key] = value.toString('utf-8');
      } else if (typeof value === 'string') {
        normalized[key] = value;
      } else if (value !== null && value !== undefined) {
        normalized[key] = String(value);
      }
    }
    return propagation.extract(ROOT_CONTEXT, normalized);
  }

  static injectIntoHttpHeaders(headers = {}) {
    return TraceContext.injectIntoHeaders(headers);
  }

  static extractFromHttpHeaders(headers = {}) {
    return TraceContext.extractFromHeaders(headers);
  }

  static injectIntoEventPayload(event) {
    if (!event) return event;

    const serialized = TraceContext.serialize();
    const enriched = { ...event };

    if (enriched.metadata && typeof enriched.metadata === 'object') {
      enriched.metadata = {
        ...enriched.metadata,
        traceContext: serialized,
      };
    } else {
      enriched.metadata = { traceContext: serialized };
    }

    return enriched;
  }

  static extractFromEventPayload(event) {
    const traceContext = event?.metadata?.traceContext;
    if (!traceContext) return ROOT_CONTEXT;
    return TraceContext.deserialize(traceContext);
  }

  static runWithExtractedContext(carrier, fn) {
    const ctx = ContextPropagator.extractFromKafkaHeaders(carrier);
    return context.with(ctx, fn);
  }

  static snapshot() {
    return TraceContext.serialize();
  }

  static restore(snapshot, fn) {
    return TraceContext.runWithContext(snapshot, fn);
  }

  static propagateAcrossAsync(carrier = {}) {
    const snapshot = ContextPropagator.snapshot();
    return {
      carrier: { ...carrier, _traceSnapshot: snapshot },
      restore: (fn) => ContextPropagator.restore(snapshot, fn),
    };
  }
}
