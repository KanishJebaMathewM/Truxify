import { TOPICS } from '../config/kafka.config.js';
import kafka from '../config/kafka.config.js';
import { BaseEvent, EventMetadata, EVENT_SOURCES } from '../../api/src/core/events/index.js';
import { ContextPropagator } from '../../api/src/core/telemetry/ContextPropagator.js';
import spanFactory from '../../api/src/core/telemetry/SpanFactory.js';
import { context, trace, SpanStatusCode } from '@opentelemetry/api';

class OrderEventService {
  constructor({ eventBus: externalEventBus } = {}) {
    this.events = [];
    this._eventBus = externalEventBus || null;
  }

  setEventBus(eventBus) {
    this._eventBus = eventBus;
  }

  _createEvent(eventType, data, source = EVENT_SOURCES.ORDER_SERVICE) {
    return new BaseEvent({
      eventType,
      payload: {
        orderId: data.orderId || data.order_id,
        ...data,
      },
      source,
    });
  }

  _publish(event) {
    if (this._eventBus) {
      this._eventBus.publish(event, { adapters: ['kafka'] });
    }
    this.events.push(event.toJSON());
    return event;
  }

  async _publishWithTracing(eventType, event, topic, orderId) {
    const span = spanFactory.startEventPublishSpan(eventType, {
      source: event.source || EVENT_SOURCES.ORDER_SERVICE,
      eventId: event.metadata?.eventId,
    });

    try {
      if (!this._eventBus) {
        const enriched = ContextPropagator.injectIntoEventPayload(event.toJSON());
        await kafka.publishEvent(topic, enriched, orderId);
      } else {
        this._publish(event);
      }
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
      return event.toJSON();
    } catch (error) {
      spanFactory.recordError(span, error);
      span.end();
      throw error;
    }
  }

  async emitOrderCreated(orderData) {
    const event = this._createEvent('ORDER_CREATED', orderData, EVENT_SOURCES.ORDER_SERVICE);
    return this._publishWithTracing('ORDER_CREATED', event, TOPICS.ORDER_CREATED, orderData.orderId);
  }

  async emitOrderUpdated(orderId, updates) {
    const event = this._createEvent('ORDER_UPDATED', { orderId, ...updates }, EVENT_SOURCES.ORDER_SERVICE);
    return this._publishWithTracing('ORDER_UPDATED', event, TOPICS.ORDER_UPDATED, orderId);
  }

  async emitOrderCancelled(orderId, reason) {
    const event = this._createEvent('ORDER_CANCELLED', {
      orderId,
      reason,
      cancelledAt: new Date().toISOString(),
    }, EVENT_SOURCES.ORDER_SERVICE);
    return this._publishWithTracing('ORDER_CANCELLED', event, TOPICS.ORDER_CANCELLED, orderId);
  }

  async emitDriverAssigned(orderId, driverData) {
    const event = this._createEvent('DRIVER_ASSIGNED', { orderId, ...driverData }, EVENT_SOURCES.ORDER_SERVICE);
    return this._publishWithTracing('DRIVER_ASSIGNED', event, TOPICS.DRIVER_ASSIGNED, orderId);
  }

  async emitPaymentConfirmed(orderId, paymentData) {
    const event = this._createEvent('PAYMENT_CONFIRMED', { orderId, ...paymentData }, EVENT_SOURCES.PAYMENT_SERVICE);
    return this._publishWithTracing('PAYMENT_CONFIRMED', event, TOPICS.PAYMENT_CONFIRMED, orderId);
  }

  async emitTripStarted(orderId, tripData) {
    const event = this._createEvent('TRIP_STARTED', { orderId, ...tripData }, EVENT_SOURCES.TRIP_SERVICE);
    return this._publishWithTracing('TRIP_STARTED', event, TOPICS.TRIP_STARTED, orderId);
  }

  async emitTripCompleted(orderId, completionData) {
    const event = this._createEvent('TRIP_COMPLETED', { orderId, ...completionData }, EVENT_SOURCES.TRIP_SERVICE);
    return this._publishWithTracing('TRIP_COMPLETED', event, TOPICS.TRIP_COMPLETED, orderId);
  }

  async emitEscrowCreated(orderId, escrowData) {
    const event = this._createEvent('ESCROW_CREATED', { orderId, ...escrowData }, EVENT_SOURCES.ESCROW_SERVICE);
    return this._publishWithTracing('ESCROW_CREATED', event, TOPICS.ESCROW_CREATED, orderId);
  }

  async emitEscrowReleased(orderId, releaseData) {
    const event = this._createEvent('ESCROW_RELEASED', { orderId, ...releaseData }, EVENT_SOURCES.ESCROW_SERVICE);
    return this._publishWithTracing('ESCROW_RELEASED', event, TOPICS.ESCROW_RELEASED, orderId);
  }

  async emitETAUpdated(orderId, etaData) {
    const event = this._createEvent('ETA_UPDATED', { orderId, ...etaData }, EVENT_SOURCES.ML_SERVICE);
    return this._publishWithTracing('ETA_UPDATED', event, TOPICS.ETA_UPDATED, orderId);
  }

  async emitLocationUpdated(orderId, locationData) {
    const event = this._createEvent('LOCATION_UPDATED', { orderId, ...locationData }, EVENT_SOURCES.TRACKING_SERVICE);
    return this._publishWithTracing('LOCATION_UPDATED', event, TOPICS.LOCATION_UPDATED, orderId);
  }

  async emitFraudDetected(orderId, fraudData) {
    const event = this._createEvent('FRAUD_DETECTED', { orderId, ...fraudData }, EVENT_SOURCES.FRAUD_SERVICE);
    return this._publishWithTracing('FRAUD_DETECTED', event, TOPICS.FRAUD_DETECTED, orderId);
  }

  async emitNotificationSent(orderId, notificationData) {
    const event = this._createEvent('NOTIFICATION_SENT', { orderId, ...notificationData }, EVENT_SOURCES.NOTIFICATION_SERVICE);
    return this._publishWithTracing('NOTIFICATION_SENT', event, TOPICS.NOTIFICATION_SENT, orderId);
  }
}

export default new OrderEventService();
