import { EventPublisher } from '../EventPublisher.js';
import logger from '../../../middleware/logger.js';
import { v4 as uuidv4 } from 'uuid';
import { ContextPropagator } from '../../telemetry/ContextPropagator.js';

export class KafkaAdapter extends EventPublisher {
  constructor(kafkaConfig) {
    super();
    this._kafkaConfig = kafkaConfig;
    this._connected = false;
    this._topicMap = new Map();
  }

  setTopicMap(map) {
    for (const [eventType, topic] of Object.entries(map)) {
      this._topicMap.set(eventType, topic);
    }
    return this;
  }

  getTopic(eventType) {
    return this._topicMap.get(eventType) || eventType.replace(/\./g, '_');
  }

  async connect() {
    if (this._connected) return;
    try {
      await this._kafkaConfig.connect();
      this._connected = true;
      logger.info('[KafkaAdapter] Connected');
    } catch (err) {
      logger.error('[KafkaAdapter] Connection failed:', err.message);
      throw err;
    }
  }

  async disconnect() {
    if (!this._connected) return;
    try {
      await this._kafkaConfig.disconnect();
      this._connected = false;
      logger.info('[KafkaAdapter] Disconnected');
    } catch (err) {
      logger.error('[KafkaAdapter] Disconnection failed:', err.message);
    }
  }

  get isConnected() {
    return this._connected;
  }

  async publish(event) {
    if (!this._connected) {
      await this.connect();
    }

    const topic = this.getTopic(event.eventType);
    const key = event.metadata?.eventId || uuidv4();

    const enriched = ContextPropagator.injectIntoEventPayload(event);

    const kafkaEvent = {
      eventId: event.metadata?.eventId || uuidv4(),
      eventType: event.eventType,
      data: event.payload,
      metadata: enriched.metadata?.toJSON ? enriched.metadata.toJSON() : enriched.metadata,
    };

    try {
      await this._kafkaConfig.publishEvent(topic, kafkaEvent, key);
      logger.debug(`[KafkaAdapter] Published "${event.eventType}" to topic "${topic}"`);
    } catch (err) {
      logger.error(`[KafkaAdapter] Failed to publish "${event.eventType}":`, err.message);
      throw err;
    }
  }

  async publishBatch(events) {
    if (!this._connected) {
      await this.connect();
    }

    const messages = events.map(event => {
      const enriched = ContextPropagator.injectIntoEventPayload(event);
      return {
        topic: this.getTopic(event.eventType),
        event: {
          eventId: event.metadata?.eventId || uuidv4(),
          eventType: event.eventType,
          data: event.payload,
          metadata: enriched.metadata?.toJSON ? enriched.metadata.toJSON() : enriched.metadata,
        },
        key: event.metadata?.eventId || uuidv4(),
      };
    });

    try {
      await this._kafkaConfig.publishBatch(messages);
      logger.debug(`[KafkaAdapter] Published ${events.length} events in batch`);
    } catch (err) {
      logger.error('[KafkaAdapter] Batch publish failed:', err.message);
      throw err;
    }
  }
}
