import kafka, { TOPICS, CONSUMER_GROUPS } from '../config/kafka.config.js';
import processedEventRepository from '../repositories/processedEvent.repository.js';
import deadLetterRepository from '../repositories/deadLetter.repository.js';
import logger from '../../api/src/middleware/logger.js';

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
      // Idempotency claim: only the first delivery of an event may apply side
      // effects. Kafka redelivers messages on restarts/rebalances, so without
      // this guard PAYMENT_CONFIRMED / TRIP_COMPLETED / ESCROW_RELEASED would
      // be processed (and credit wallets) more than once.
      const eventId = message?.metadata?.eventId || rawMessage?.key?.toString() || null;
      if (eventId) {
        const isNew = await processedEventRepository.claimProcessed(
          topic,
          eventId,
          message?.orderId || message?.payload?.orderId || null
        );
        if (!isNew) {
          logger.info(`[OrderConsumer] Skipping duplicate event ${eventId} on ${topic}`);
          return;
        }
      }

      if (handlers.has(topic)) {
        const topicHandlers = handlers.get(topic);
        for (const handler of topicHandlers) {
          try {
            await handler(message, rawMessage);
          } catch (error) {
            logger.error(`Handler error for ${topic}:`, error);
            await this.storeDeadLetter(topic, rawMessage, error);
          }
        }
      }

      if (this._eventBus) {
        const eventType = topic.replace(/\./g, '_').toUpperCase();
        if (message && typeof message === 'object' && message.metadata) {
          // Object form reuses the original event id so the in-process
          // EventBus deduplication window applies to redelivered messages.
          this._eventBus.publish(message, {
            adapters: [],
            source: `kafka:${groupId}`,
          });
        } else {
          this._eventBus.publish(eventType, message, {
            adapters: [],
            source: `kafka:${groupId}`,
          });
        }
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
    const rawValue = message?.value;
    const serialized = Buffer.isBuffer(rawValue)
      ? rawValue.toString()
      : rawValue != null
        ? String(rawValue)
        : null;

    const dlqEntry = {
      topic,
      message: serialized,
      error: error.message,
      timestamp: new Date().toISOString(),
      retryCount: 0,
    };

    const stored = await deadLetterRepository.store({
      topic,
      message: dlqEntry,
      error: error.message,
      retryCount: 0,
    });

    if (stored) {
      logger.info(`📦 Dead letter persisted for ${topic} (id: ${stored.id})`);
    } else {
      logger.error(`📦 Dead letter for ${topic} could NOT be persisted — message dropped`, dlqEntry);
    }
  }

  async replayDeadLetters({ topic = null, limit = 50 } = {}) {
    const pending = await deadLetterRepository.listPending({ topic, limit });
    const results = { attempted: pending.length, succeeded: 0, failed: 0 };

    for (const entry of pending) {
      const topicHandlers = this.handlers.get(entry.topic) || [];

      // entry.message is the DLQ wrapper object
      // ({ topic, message, error, timestamp, retryCount }); its `message` field
      // holds the JSON-encoded original Kafka value. Handlers are registered
      // for the original event shape, so replay must feed them the parsed
      // event, not the wrapper.
      let parsedMessage;
      try {
        const serialized = typeof entry.message === 'string'
          ? entry.message
          : entry.message?.message;
        parsedMessage = JSON.parse(serialized);
      } catch (error) {
        logger.error(`Replay failed for dead letter ${entry.id} (${entry.topic}): message is not valid JSON:`, error);
        await deadLetterRepository.markStatus(entry.id, 'pending', { incrementRetry: true });
        results.failed += 1;
        continue;
      }

      try {
        for (const handler of topicHandlers) {
          await handler(parsedMessage, { value: parsedMessage });
        }
        await deadLetterRepository.markStatus(entry.id, 'replayed');
        results.succeeded += 1;
      } catch (error) {
        logger.error(`Replay failed for dead letter ${entry.id} (${entry.topic}):`, error);
        await deadLetterRepository.markStatus(entry.id, 'pending', { incrementRetry: true });
        results.failed += 1;
      }
    }

    logger.info(`♻️ Dead letter replay complete`, results);
    return results;
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