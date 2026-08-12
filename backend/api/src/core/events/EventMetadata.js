import crypto from 'crypto';

export const EVENT_VERSIONS = Object.freeze({
  CURRENT: '1.0',
});

export const EVENT_SOURCES = Object.freeze({
  ORDER_SERVICE: 'order-service',
  PAYMENT_SERVICE: 'payment-service',
  TRIP_SERVICE: 'trip-service',
  ESCROW_SERVICE: 'escrow-service',
  TRACKING_SERVICE: 'tracking-service',
  ML_SERVICE: 'ml-service',
  NOTIFICATION_SERVICE: 'notification-service',
  FRAUD_SERVICE: 'fraud-service',
  REPUTATION_SERVICE: 'reputation-service',
  WORKER: 'worker',
  INTERNAL: 'internal',
});

export const EVENT_CATEGORIES = Object.freeze({
  DOMAIN: 'domain',
  INFRASTRUCTURE: 'infrastructure',
});

export class EventMetadata {
  constructor({
    eventId,
    eventType,
    source,
    category = EVENT_CATEGORIES.DOMAIN,
    version = EVENT_VERSIONS.CURRENT,
    correlationId,
    causationId,
    timestamp,
  } = {}) {
    this.eventId = eventId || crypto.randomUUID();
    this.eventType = eventType;
    this.source = source || EVENT_SOURCES.INTERNAL;
    this.category = category;
    this.version = version;
    this.correlationId = correlationId || null;
    this.causationId = causationId || null;
    this.timestamp = timestamp || new Date().toISOString();
  }

  toJSON() {
    return {
      eventId: this.eventId,
      eventType: this.eventType,
      source: this.source,
      category: this.category,
      version: this.version,
      correlationId: this.correlationId,
      causationId: this.causationId,
      timestamp: this.timestamp,
    };
  }

  static fromJSON(json) {
    return new EventMetadata(json);
  }
}
