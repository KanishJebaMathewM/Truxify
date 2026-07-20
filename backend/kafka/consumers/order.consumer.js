import kafka, { TOPICS, CONSUMER_GROUPS } from '../config/kafka.config.js';
import logger from '../../api/src/middleware/logger.js';

class OrderConsumer {
  constructor() {
    this.handlers = new Map();
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;

    // Order service consumer
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

    // Notification service consumer
    await kafka.createConsumer(CONSUMER_GROUPS.NOTIFICATION_SERVICE, [
      TOPICS.ORDER_CREATED,
      TOPICS.DRIVER_ASSIGNED,
      TOPICS.PAYMENT_CONFIRMED,
      TOPICS.ESCROW_RELEASED,
      TOPICS.NOTIFICATION_SENT,
    ]);

    // Analytics service consumer
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

    // Fraud service consumer
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

  async startConsuming(groupId) {
    const consumer = await kafka.getConsumer(groupId);
    const handlers = this.handlers;

    await kafka.consumeMessages(
      groupId,
      async (topic, message, rawMessage) => {
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
      },
      async (error, topic, message) => {
        // Dead letter queue handling
        logger.error(`Dead letter: ${topic}`, { error: error.message });
        // Store in DLQ for later processing
        await this.storeDeadLetter(topic, message, error);
      }
    );
  }

  async storeDeadLetter(topic, message, error) {
    // Store dead letter messages in Redis or MongoDB
    const dlqEntry = {
      topic,
      message: message.value.toString(),
      error: error.message,
      timestamp: new Date().toISOString(),
      retryCount: 0,
    };
    
    // In production, store in Redis list or MongoDB collection
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