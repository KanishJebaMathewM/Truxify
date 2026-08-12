import { context, trace, SpanStatusCode } from '@opentelemetry/api';
import { ContextPropagator } from './ContextPropagator.js';
import spanFactory, { STANDARD_ATTRIBUTES } from './SpanFactory.js';

export class EventTracer {
  static wrapPublish(publishFn, eventBusInstance) {
    return function tracedPublish(eventOrType, payloadOrOptions, optionsOrUndefined) {
      let eventType;
      let source = 'unknown';
      let eventId = null;

      if (eventOrType && typeof eventOrType === 'object' && eventOrType.metadata) {
        eventType = eventOrType.metadata.eventType || eventOrType.eventType;
        source = eventOrType.metadata.source || eventOrType.source || 'unknown';
        eventId = eventOrType.metadata.eventId;
      } else if (typeof eventOrType === 'string') {
        eventType = eventOrType;
        if (payloadOrOptions && typeof payloadOrOptions === 'object' && payloadOrOptions.metadata) {
          source = payloadOrOptions.metadata.source || 'unknown';
        }
      }

      if (!eventType) {
        return publishFn.call(eventBusInstance, eventOrType, payloadOrOptions, optionsOrUndefined);
      }

      const span = spanFactory.startEventPublishSpan(eventType, { source, eventId });
      const enrichedEvent = eventOrType && typeof eventOrType === 'object'
        ? ContextPropagator.injectIntoEventPayload(eventOrType)
        : eventOrType;

      try {
        const result = context.with(trace.setSpan(context.active(), span), () => {
          return publishFn.call(eventBusInstance, enrichedEvent, payloadOrOptions, optionsOrUndefined);
        });

        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
        return result;
      } catch (error) {
        spanFactory.recordError(span, error);
        span.end();
        throw error;
      }
    };
  }

  static wrapSubscribe(eventType, handler) {
    return function tracedHandler(event) {
      const parentCtx = event?.metadata?.traceContext
        ? ContextPropagator.extractFromEventPayload(event)
        : undefined;

      const handlerName = handler.name || 'anonymous';
      const startOptions = {
        attributes: {
          [STANDARD_ATTRIBUTES.EVENT_TYPE]: eventType,
          'handler.name': handlerName,
        },
      };

      if (parentCtx) {
        startOptions.parentContext = parentCtx;
      }

      return spanFactory.withSpan(`event.subscribe.${eventType}`, async () => {
        return await handler(event);
      }, startOptions);
    };
  }

  static wrapEventHandler(handlerName, handlerFn) {
    return async function tracedEventHandler(event) {
      const parentCtx = event?.metadata?.traceContext
        ? ContextPropagator.extractFromEventPayload(event)
        : undefined;

      const eventType = event?.metadata?.eventType || event?.eventType || 'unknown';
      const startOptions = {
        attributes: {
          [STANDARD_ATTRIBUTES.EVENT_TYPE]: eventType,
          'handler.name': handlerName,
          'handler.source': event?.metadata?.source || 'unknown',
        },
      };

      if (parentCtx) {
        startOptions.parentContext = parentCtx;
      }

      return spanFactory.withSpan(`event.handler.${handlerName}`, async () => {
        return await handlerFn(event);
      }, startOptions);
    };
  }

  static traceEventBus(eventBusInstance) {
    const originalPublish = eventBusInstance.publish.bind(eventBusInstance);
    eventBusInstance.publish = EventTracer.wrapPublish(originalPublish, eventBusInstance);

    const originalOn = eventBusInstance.on.bind(eventBusInstance);
    eventBusInstance.on = function tracedOn(eventType, handler) {
      if (typeof handler === 'function') {
        return originalOn.call(eventBusInstance, eventType, EventTracer.wrapSubscribe(eventType, handler));
      }
      return originalOn.call(eventBusInstance, eventType, handler);
    };

    return eventBusInstance;
  }
}
