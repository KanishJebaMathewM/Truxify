import kafka, { TOPICS, CONSUMER_GROUPS } from '../config/kafka.config.js';
import processedEventRepository from '../repositories/processedEvent.repository.js';
import deadLetterRepository from '../repositories/deadLetter.repository.js';
import orderReadModel from '../cqrs/order.read.model.js';
import logger from '../../api/src/middleware/logger.js';

// Topics whose only side effect is the order read-model projection. These are
// applied ATOMICALLY with their idempotency record (apply_order_event), so a
// duplicate/replayed message is a no-op and an event is never marked processed
// before its read-model update succeeds.
const ORDER_READ_MODEL_TOPICS = new Set([
  TOPICS.ORDER_CREATED,
  TOPICS.ORDER_UPDATED,
  TOPICS.ORDER_CANCELLED,
  TOPICS.DRIVER_ASSIGNED,
]);
const MAX_REPLAY_ATTEMPTS = 3;

class OrderConsumer {
  constructor({ eventBus: externalEventBus } = {}) {
    this.handlers = new Map();
    this.initialized = false;
    this._eventBus = externalEventBus || null;
    this.createdConsumerGroups = [];
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

    this.createdConsumerGroups = [
      CONSUMER_GROUPS.ORDER_SERVICE,
      CONSUMER_GROUPS.NOTIFICATION_SERVICE,
      CONSUMER_GROUPS.ANALYTICS_SERVICE,
      CONSUMER_GROUPS.FRAUD_SERVICE,
    ];

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
      // Set when a side-effect topic claims the event for two-phase
      // processing; used below to flip the claim to completed/failed.
      let claimedEventId = null;

      // Order read-model topics: apply the event atomically with its
      // idempotency record. If the event was already applied (duplicate,
      // redelivery after a restart, replay, or a publish retried after a
      // crash), applyEvent returns false and we skip all side effects.
      if (ORDER_READ_MODEL_TOPICS.has(topic)) {
        const eventId = message?.eventId || message?.metadata?.eventId || rawMessage?.key?.toString() || null;
        const orderId = message?.aggregateId || message?.orderId || message?.payload?.orderId || rawMessage?.key?.toString() || null;

        const applied = await orderReadModel.applyEvent({
          topic,
          eventId,
          orderId,
          eventType: message?.eventType,
          payload: message?.payload,
          version: message?.version,
        });

        if (!applied) {
          logger.info(`[OrderConsumer] Skipping duplicate event ${eventId} on ${topic}`, { orderId });
          return;
        }
      } else {
        // Side-effect topics (wallet credits, notifications, ...): claim the
        // event as 'processing' BEFORE running handlers so a redelivery can
        // never apply the same side effect twice concurrently, then flip the
        // claim to 'completed' only after the handlers succeed (issue #11192).
        // A failed handler flips it to 'failed' so a later delivery can
        // re-claim and retry the event instead of losing the side effect.
        const eventId = message?.metadata?.eventId || rawMessage?.key?.toString() || null;
        claimedEventId = eventId;
        if (eventId) {
          const isNew = await processedEventRepository.claimProcessing(
            topic,
            eventId,
            message?.orderId || message?.payload?.orderId || null
          );
          if (!isNew) {
            logger.info(`[OrderConsumer] Skipping duplicate event ${eventId} on ${topic}`);
            return;
          }
        }
      }

      let handlerFailed = false;
      if (handlers.has(topic)) {
        const topicHandlers = handlers.get(topic);
        for (const handler of topicHandlers) {
          try {
            await handler(message, rawMessage);
          } catch (error) {
            handlerFailed = true;
            logger.error(`Handler error for ${topic}:`, error);
            await this.storeDeadLetter(topic, rawMessage, error);
          }
        }
      }

      if (this._eventBus) {
        const eventType = topic.replace(/\./g, '_').toUpperCase();
        try {
          if (message && typeof message === 'object' && message.metadata) {
            // Object form reuses the original event id so the in-process
            // EventBus deduplication window applies to redelivered messages.
            await this._eventBus.publish(message, {
              adapters: [],
              source: `kafka:${groupId}`,
            });
          } else {
            await this._eventBus.publish(eventType, message, {
              adapters: [],
              source: `kafka:${groupId}`,
            });
          }
        } catch (error) {
          handlerFailed = true;
          logger.error(`EventBus publish error for ${topic}:`, error);
        }
      }

      // Two-phase claim resolution for side-effect topics: only a fully
      // succeeded handler run (and EventBus fan-out) marks the event
      // 'completed'. Any failure leaves it 'failed' so the next delivery can
      // re-claim and retry it (issue #11192).
      if (claimedEventId) {
        if (handlerFailed) {
          await processedEventRepository.markFailed(topic, claimedEventId);
        } else {
          await processedEventRepository.markCompleted(topic, claimedEventId);
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
        if ((entry.retry_count ?? 0) >= MAX_REPLAY_ATTEMPTS) {
          await deadLetterRepository.markStatus(entry.id, 'failed');
          logger.error(`Dead letter ${entry.id} (${entry.topic}) marked failed after ${entry.retry_count ?? 0} retries`);
        } else {
          await deadLetterRepository.markStatus(entry.id, 'pending', { incrementRetry: true });
        }
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
        // Cap replay attempts so a poison message is not retried forever.
        // After the cap the dead letter is marked failed and no longer
        // picked up by listPending(), otherwise each replay cycles the same
        // failing entry back into the pending queue indefinitely.
        if ((entry.retry_count ?? 0) >= MAX_REPLAY_ATTEMPTS) {
          await deadLetterRepository.markStatus(entry.id, 'failed');
          logger.error(`Dead letter ${entry.id} (${entry.topic}) marked failed after ${entry.retry_count ?? 0} retries`);
        } else {
          await deadLetterRepository.markStatus(entry.id, 'pending', { incrementRetry: true });
        }
        results.failed += 1;
      }
    }

    logger.info(`♻️ Dead letter replay complete`, results);
    return results;
  }

  async startAllConsumers() {
    await this.initialize();

    // Only start consumer groups that were actually created in initialize().
    // CONSUMER_GROUPS also declares DRIVER/PAYMENT/ESCROW groups that are not
    // wired up yet, and startConsuming() would fail on getConsumer() for them.
    const consumerGroups = this.createdConsumerGroups;
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

// === Spec 31: ===
// === Spec 31: idempotent dedup ===
const TTL = 24 * 60 * 60;
export async function markProcessed(redis, key) {
  const r = await redis.set(`dedup:${key}`, '1', 'EX', TTL, 'NX');
  return r === 'OK';
}

