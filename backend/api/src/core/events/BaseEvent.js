import { EventMetadata, EVENT_CATEGORIES, EVENT_VERSIONS, EVENT_SOURCES } from './EventMetadata.js';

export class BaseEvent {
  constructor({
    eventType,
    payload = {},
    source,
    category = EVENT_CATEGORIES.DOMAIN,
    version = EVENT_VERSIONS.CURRENT,
    correlationId = null,
    causationId = null,
    metadata: existingMetadata,
  } = {}) {
    if (!eventType || typeof eventType !== 'string') {
      throw new Error('BaseEvent requires a non-empty eventType string');
    }

    this.metadata = existingMetadata instanceof EventMetadata
      ? existingMetadata
      : new EventMetadata({
          eventType,
          source,
          category,
          version,
          correlationId,
          causationId,
        });

    this.payload = payload;
  }

  get eventId() {
    return this.metadata.eventId;
  }

  get eventType() {
    return this.metadata.eventType;
  }

  get timestamp() {
    return this.metadata.timestamp;
  }

  get source() {
    return this.metadata.source;
  }

  get category() {
    return this.metadata.category;
  }

  get correlationId() {
    return this.metadata.correlationId;
  }

  withCorrelationId(correlationId) {
    this.metadata.correlationId = correlationId;
    return this;
  }

  withCausationId(causationId) {
    this.metadata.causationId = causationId;
    return this;
  }

  toJSON() {
    return {
      metadata: this.metadata.toJSON(),
      payload: this.payload,
    };
  }

  static fromJSON(json) {
    const metadata = json.metadata instanceof EventMetadata
      ? json.metadata
      : EventMetadata.fromJSON(json.metadata);
    return new BaseEvent({
      eventType: metadata.eventType,
      payload: json.payload,
      metadata,
    });
  }
}
