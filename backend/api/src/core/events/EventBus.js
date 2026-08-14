import EventEmitter from 'events';
import logger from '../../middleware/logger.js';
import { EventMetadata, EVENT_CATEGORIES } from './EventMetadata.js';
import { EventRegistry } from './EventRegistry.js';
import { ContextPropagator } from '../telemetry/ContextPropagator.js';
import { context, trace, SpanStatusCode } from '@opentelemetry/api';
import spanFactory, { STANDARD_ATTRIBUTES } from '../telemetry/SpanFactory.js';

class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
    this._adapters = new Map();
    this._registry = new EventRegistry();
    this._deduplication = new Map();
    this._deduplicationWindowMs = 60000;
    this._listenerWrappers = new Map();
    this._metrics = {
      published: 0,
      subscribed: 0,
      errors: 0,
      deduplicated: 0,
    };
  }

  get registry() {
    return this._registry;
  }

  get metrics() {
    return { ...this._metrics };
  }

  registerAdapter(name, adapter) {
    this._adapters.set(name, adapter);
    logger.info(`[EventBus] Adapter registered: ${name}`);
    return this;
  }

  removeAdapter(name) {
    this._adapters.delete(name);
    logger.info(`[EventBus] Adapter removed: ${name}`);
    return this;
  }

  async connectAdapters() {
    for (const [name, adapter] of this._adapters) {
      try {
        if (typeof adapter.connect === 'function') {
          await adapter.connect();
          logger.info(`[EventBus] Adapter connected: ${name}`);
        }
      } catch (err) {
        logger.error(`[EventBus] Failed to connect adapter "${name}":`, err.message);
      }
    }
  }

  async disconnectAdapters() {
    for (const [name, adapter] of this._adapters) {
      try {
        if (typeof adapter.disconnect === 'function') {
          await adapter.disconnect();
          logger.info(`[EventBus] Adapter disconnected: ${name}`);
        }
      } catch (err) {
        logger.error(`[EventBus] Failed to disconnect adapter "${name}":`, err.message);
      }
    }
  }

  publish(eventOrType, payloadOrOptions, optionsOrUndefined) {
    let event;
    let options;

    if (eventOrType && typeof eventOrType === 'object' && eventOrType.metadata) {
      event = eventOrType;
      options = payloadOrOptions || {};
    } else if (typeof eventOrType === 'string') {
      const eventType = eventOrType;
      const payload = payloadOrOptions;
      options = optionsOrUndefined || {};

      const metadata = new EventMetadata({
        eventType,
        source: options.source,
        category: options.category || EVENT_CATEGORIES.DOMAIN,
        version: options.version,
        correlationId: options.correlationId,
      });

      event = {
        metadata,
        payload: payload !== undefined ? payload : {},
      };
    } else {
      throw new Error('EventBus.publish() requires either a BaseEvent instance or (eventType, payload, options)');
    }

    const eventType = event.metadata?.eventType || event.eventType;
    const source = event.metadata?.source || 'unknown';
    const eventId = event.metadata?.eventId;

    if (this._registry.isValid(eventType)) {
      const validation = this._registry.validate(eventType, event.payload);
      if (!validation.valid) {
        logger.warn(`[EventBus] Event validation failed for "${eventType}": ${validation.error}`);
      }
    }

    if (options.deduplicate !== false && this._isDuplicate(event)) {
      this._metrics.deduplicated++;
      logger.debug(`[EventBus] Duplicate event suppressed: ${event.metadata?.eventId}`);
      return this;
    }

    const traceSnapshot = ContextPropagator.snapshot();

    const enrichedEvent = ContextPropagator.injectIntoEventPayload(event);

    const span = spanFactory.startEventPublishSpan(eventType, { source, eventId });

    try {
      context.with(trace.setSpan(context.active(), span), () => {
        this._metrics.published++;
        this.emitSafe(eventType, enrichedEvent);

        if (options.adapters !== false) {
          this._publishToAdapters(enrichedEvent, options);
        }
      });

      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
    } catch (error) {
      spanFactory.recordError(span, error);
      span.end();
      throw error;
    }

    return this;
  }

  emitSafe(event, ...args) {
    const listeners = this.rawListeners(event);
    for (const listener of listeners) {
      try {
        const result = listener.apply(this, args);
        if (result && typeof result.catch === 'function') {
          result.catch(err => {
            logger.error(`[EventBus] Unhandled async listener error for "${event}":`, err);
            this._metrics.errors++;
          });
        }
      } catch (err) {
        logger.error(`[EventBus] Sync listener error for "${event}":`, err);
        this._metrics.errors++;
      }
    }
    return listeners.length > 0;
  }

  subscribe(eventType, handler) {
    if (typeof handler === 'function') {
      this._metrics.subscribed++;
      const tracedHandler = (event) => {
        const parentCtx = event?.metadata?.traceContext
          ? ContextPropagator.extractFromEventPayload(event)
          : undefined;

        const span = spanFactory.startEventSubscribeSpan(eventType, {
          source: event?.metadata?.source || 'unknown',
        });

        const runContext = parentCtx || context.active();
        return context.with(trace.setSpan(runContext, span), async () => {
          try {
            const result = await handler(event);
            span.setStatus({ code: SpanStatusCode.OK });
            span.end();
            return result;
          } catch (error) {
            spanFactory.recordError(span, error);
            span.end();
            throw error;
          }
        });
      };
      this._registerListener(eventType, handler, tracedHandler);
      return this;
    }

    if (handler && typeof handler.handle === 'function') {
      this._metrics.subscribed++;
      const instanceHandler = (event) => handler.handle(event);
      this._registerListener(eventType, handler, instanceHandler);
      return this;
    }

    throw new Error('subscribe() requires a function or EventHandler instance');
  }

  _registerListener(eventType, handler, listener) {
    let byHandler = this._listenerWrappers.get(eventType);
    if (!byHandler) {
      byHandler = new Map();
      this._listenerWrappers.set(eventType, byHandler);
    }
    const listeners = byHandler.get(handler);
    if (listeners) {
      listeners.push(listener);
    } else {
      byHandler.set(handler, [listener]);
    }
    this.on(eventType, listener);
  }

  unsubscribe(eventType, handler) {
    const byHandler = this._listenerWrappers.get(eventType);
    const listeners = byHandler?.get(handler);
    if (listeners) {
      for (const listener of listeners) {
        this.removeListener(eventType, listener);
      }
      byHandler.delete(handler);
      if (byHandler.size === 0) {
        this._listenerWrappers.delete(eventType);
      }
    }
    return this;
  }

  async publishAsync(eventOrType, payloadOrOptions, options) {
    return new Promise((resolve, reject) => {
      try {
        this.publish(eventOrType, payloadOrOptions, options);
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Publish an event and report the delivery outcome so callers (e.g. the
   * outbox relay worker) can decide whether to acknowledge a message.
   * Accepts the same (event | eventType) shapes as publish() plus a plain
   * event object carrying an eventType field.
   *
   * @returns {Promise<{
   *   published: boolean,
   *   deduplicated: boolean,
   *   consumed: boolean,
   *   adapterAttempted: number,
   *   adapterFailures: number,
   *   adapterErrors: string[],
   * }>}
   */
  async publishAndReport(eventOrType, payloadOrOptions, optionsOrUndefined) {
    let event;
    let options;

    if (eventOrType && typeof eventOrType === 'object' && eventOrType.metadata) {
      event = eventOrType;
      options = payloadOrOptions || {};
    } else if (typeof eventOrType === 'string') {
      const eventType = eventOrType;
      const payload = payloadOrOptions;
      options = optionsOrUndefined || {};
      const metadata = new EventMetadata({
        eventType,
        source: options.source,
        category: options.category || EVENT_CATEGORIES.DOMAIN,
        version: options.version,
        correlationId: options.correlationId,
      });
      event = { metadata, payload: payload !== undefined ? payload : {} };
    } else if (eventOrType && typeof eventOrType === 'object' && eventOrType.eventType) {
      const { payload, ...rest } = eventOrType;
      const metadata = new EventMetadata({
        eventType: eventOrType.eventType,
        source: payloadOrOptions?.source,
        category: payloadOrOptions?.category || EVENT_CATEGORIES.DOMAIN,
        version: payloadOrOptions?.version,
        correlationId: payloadOrOptions?.correlationId,
      });
      options = payloadOrOptions || {};
      event = { metadata, payload: payload !== undefined ? payload : {}, ...rest };
    } else {
      throw new Error('EventBus.publishAndReport() requires a BaseEvent instance, (eventType, payload, options), or an event object with an eventType field');
    }

    const eventType = event.metadata?.eventType || event.eventType;

    const report = {
      published: true,
      deduplicated: false,
      consumed: false,
      adapterAttempted: 0,
      adapterFailures: 0,
      adapterErrors: [],
    };

    if (this._registry.isValid(eventType)) {
      const validation = this._registry.validate(eventType, event.payload);
      if (!validation.valid) {
        logger.warn(`[EventBus] Event validation failed for "${eventType}": ${validation.error}`);
      }
    }

    if (options.deduplicate !== false && this._isDuplicate(event)) {
      this._metrics.deduplicated++;
      report.deduplicated = true;
      report.published = false;
      logger.debug(`[EventBus] Duplicate event suppressed: ${event.metadata?.eventId}`);
      return report;
    }

    const enrichedEvent = ContextPropagator.injectIntoEventPayload(event);
    this._metrics.published++;
    report.consumed = this.emitSafe(eventType, enrichedEvent);

    if (options.adapters !== false) {
      const targetAdapters = options.adapters || null;
      for (const [name, adapter] of this._adapters) {
        if (targetAdapters && !targetAdapters.includes(name)) continue;
        if (typeof adapter.publish !== 'function') continue;
        report.adapterAttempted++;
        try {
          await adapter.publish(enrichedEvent);
        } catch (err) {
          report.adapterFailures++;
          report.adapterErrors.push(`${name}: ${err.message}`);
          this._metrics.errors++;
        }
      }
    }

    return report;
  }

  _isDuplicate(event) {
    const eventId = event.metadata?.eventId;
    if (!eventId) return false;

    const now = Date.now();
    const lastSeen = this._deduplication.get(eventId);
    if (lastSeen && (now - lastSeen) < this._deduplicationWindowMs) {
      return true;
    }

    this._deduplication.set(eventId, now);

    if (this._deduplication.size > 10000) {
      const cutoff = now - this._deduplicationWindowMs;
      for (const [key, timestamp] of this._deduplication) {
        if (timestamp < cutoff) {
          this._deduplication.delete(key);
        }
      }
    }

    return false;
  }

  async _publishToAdapters(event, options) {
    const eventType = event.metadata?.eventType || event.eventType;
    const targetAdapters = options.adapters || null;
    for (const [name, adapter] of this._adapters) {
      if (targetAdapters && !targetAdapters.includes(name)) continue;
      try {
        if (typeof adapter.publish === 'function') {
          await adapter.publish(event);
        }
      } catch (err) {
        logger.error(`[EventBus] Adapter "${name}" publish failed for "${eventType}":`, err.message);
        this._metrics.errors++;
      }
    }
  }

  clearMetrics() {
    this._metrics = { published: 0, subscribed: 0, errors: 0, deduplicated: 0 };
  }
}

const eventBus = new EventBus();

export { EventBus };
export default eventBus;
