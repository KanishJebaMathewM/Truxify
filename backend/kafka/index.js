import dotenv from 'dotenv';
import kafka from './config/kafka.config.js';
import orderEvents from './events/order.events.js';
import orderConsumer from './consumers/order.consumer.js';
import orderReadModel from './cqrs/order.read.model.js';
import outboxRepository from './repositories/outbox.repository.js';
import { OutboxRelay } from './relay/outbox.relay.js';
import logger from '../api/src/middleware/logger.js';

dotenv.config();

const OUTBOX_RELAY_INTERVAL_MS = Number(process.env.OUTBOX_RELAY_INTERVAL_MS) > 0
  ? Number(process.env.OUTBOX_RELAY_INTERVAL_MS)
  : 5000;

async function main() {
  try {
    logger.info('🚀 Starting Kafka event-driven services...');

    await kafka.connect();

    await orderConsumer.initialize();

    // The order read-model projection is applied ATOMICALLY inside the
    // consumer (order.read.model.js applyEvent -> apply_order_event RPC), so
    // no read-model handler is registered here. These handlers are kept for
    // observability and for optional extra projections.
    orderConsumer.registerHandler('order.created', async (message) => {
      const orderId = message?.aggregateId || message?.orderId || message?.payload?.orderId;
      logger.info('📥 Order created event received', { orderId });
    });

    orderConsumer.registerHandler('order.updated', async (message) => {
      const orderId = message?.aggregateId || message?.orderId || message?.payload?.orderId;
      logger.info('📥 Order updated event received', { orderId });
    });

    orderConsumer.registerHandler('driver.assigned', async (message) => {
      const orderId = message?.aggregateId || message?.orderId || message?.payload?.orderId;
      logger.info('📥 Driver assigned event received', { orderId });
    });

    orderConsumer.registerHandler('payment.confirmed', async (message) => {
      const orderId = message?.aggregateId || message?.orderId || message?.payload?.orderId;
      logger.info('📥 Payment confirmed event received', { orderId });
    });

    await orderConsumer.startAllConsumers();

    // Transactional outbox relay: order mutations are committed with a durable
    // event_outbox row; this relay publishes those events to Kafka and marks
    // them published only after a successful send. A Kafka outage never loses
    // committed events — rows stay pending and are retried.
    const outboxRelay = new OutboxRelay({
      repository: outboxRepository,
      publisher: async ({ topic, key, envelope }) => {
        await kafka.publishEvent(topic, envelope, key);
      },
      loggerAdapter: logger,
    });
    outboxRelay.run({ intervalMs: OUTBOX_RELAY_INTERVAL_MS }).catch((error) => {
      logger.error('❌ Outbox relay stopped unexpectedly:', error);
    });

    logger.info('✅ Kafka event-driven services started');

  } catch (error) {
    logger.error('❌ Failed to start Kafka services:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down...');
  await kafka.disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down...');
  await kafka.disconnect();
  process.exit(0);
});

main();


// === Spec 35: ===
// === Spec 35: deterministic partition key ===
import crypto from 'crypto';
export function derivePartitionKey(orderId) {
  if (!orderId) return '0';
  const h = crypto.createHash('sha256').update(String(orderId)).digest();
  return h.readUInt32BE(0).toString();
}

