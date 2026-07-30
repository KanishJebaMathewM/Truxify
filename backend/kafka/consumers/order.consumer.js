import kafka, { TOPICS, CONSUMER_GROUPS } from '../config/kafka.config.js';
import logger from '../api/src/middleware/logger.js';

class OrderConsumer {
  constructor({ eventBus: externalEventBus } = {}) {
    this.handlers = new Map();
    this.initialized = false;
    this._eventBus = externalEventBus || null;
  }

  setEventBus(eventBus) {
    this._eventBus = eventBus;
  }

  async initialize() {
    if (this.initialized) return;

    await kafka.createConsumer(CONSUMER_GROUPS.ORDER_SERVICE, [
      TOPICS.ORDER_CREATED,
      TOPICS.ORDER_UPDATED,
      TOPICS.ORDER_CANCELLED,
      TOPICS.DRIVER_ASSIGNED,
      TOPICS.PAYMENT_CONFIRMED,
      TOPICS.TRIP_STARTED,
      TOPICS.TRIP_COMPLETED,
      TOPICS.ESCROW_CREATED,
      TOPICS.ESCROW_RELEASED,
    ]);

    await kafka.createConsumer(CONSUMER_GROUPS.NOTIFICATION_SERVICE, [
      TOPICS.ORDER_CREATED,
      TOPICS.DRIVER_ASSIGNED,
      TOPICS.PAYMENT_CONFIRMED,
      TOPICS.ESCROW_RELEASED,
      TOPICS.NOTIFICATION_SENT,
    ]);

    await kafka.createConsumer(CONSUMER_GROUPS.ANALYTICS_SERVICE, [
      TOPICS.ORDER_CREATED,
      TOPICS.ORDER_UPDATED,
      TOPICS.ORDER_CANCELLED,
      TOPICS.DRIVER_ASSIGNED,
      TOPICS.PAYMENT_CONFIRMED,
      TOPICS.TRIP_STARTED,
      TOPICS.TRIP_COMPLETED,
      TOPICS.ETA_UPDATED,
      TOPICS.LOCATION_UPDATED,
    ]);

    await kafka.createConsumer(CONSUMER_GROUPS.FRAUD_SERVICE, [
      TOPICS.ORDER_CREATED,
      TOPICS.PAYMENT_CONFIRMED,
      TOPICS.FRAUD_DETECTED,
    ]);

    this.initialized = true;
    logger.info('✅ Kafka consumers initialized');
  }

  registerHandler(topic, handler) {
    if (!this.handlers.has(topic)) {
      this.handlers.set(topic, []);
    }
    this.handlers.get(topic).push(handler);
  }

  registerHandlerViaEventBus(eventType, handler) {
    if (this._eventBus) {
      this._eventBus.subscribe(eventType, handler);
      logger.info(`[OrderConsumer] Registered EventBus handler for "${eventType}"`);
    } else {
      logger.warn('[OrderConsumer] No EventBus set, falling back to direct handler registration');
      this.registerHandler(eventType, handler);
    }
  }

  async startConsuming(groupId) {
    const consumer = await kafka.getConsumer(groupId);
    const handlers = this.handlers;

    const messageHandler = async (topic, message, rawMessage) => {
      if (handlers.has(topic)) {
        const topicHandlers = handlers.get(topic);
        for (const handler of topicHandlers) {
          try {
            await handler(message, rawMessage);
          } catch (error) {
            logger.error(`Handler error for ${topic}:`, error);
          }
        }
      }

      if (this._eventBus) {
        const eventType = topic.replace(/\./g, '_').toUpperCase();
        this._eventBus.publish(eventType, message, {
          adapters: [],
          deduplicate: false,
          source: `kafka:${groupId}`,
        });
      }
    };

    await kafka.consumeMessages(
      groupId,
      messageHandler,
      async (error, topic, message) => {
        logger.error(`Dead letter: ${topic}`, { error: error.message });
        await this.storeDeadLetter(topic, message, error);
      }
    );
  }

  async storeDeadLetter(topic, message, error) {
    const dlqEntry = {
      topic,
      message: message.value.toString(),
      error: error.message,
      timestamp: new Date().toISOString(),
      retryCount: 0,
    };
    logger.info(`📦 Dead letter stored for ${topic}`, dlqEntry);
  }

  async startAllConsumers() {
    await this.initialize();

    const consumerGroups = Object.values(CONSUMER_GROUPS);
    for (const groupId of consumerGroups) {
      try {
        await this.startConsuming(groupId);
        logger.info(`✅ Consumer ${groupId} started`);
      } catch (error) {
        logger.error(`❌ Failed to start consumer ${groupId}:`, error);
      }
    }
  }
}

export default new OrderConsumer();
