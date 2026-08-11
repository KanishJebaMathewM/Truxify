import dotenv from 'dotenv';
import kafka from './config/kafka.config.js';
import orderEvents from './events/order.events.js';
import orderConsumer from './consumers/order.consumer.js';
import orderReadModel from './cqrs/order.read.model.js';
import logger from '../api/src/middleware/logger.js';
import { startOutboxRelay, stopOutboxRelay } from './relay/outboxRelay.js';

dotenv.config();

async function main() {
  try {
    logger.info('🚀 Starting Kafka event-driven services...');

    await kafka.connect();

    await orderConsumer.initialize();

    orderConsumer.registerHandler('order.created', async (message) => {
      const orderId = message?.orderId || message?.payload?.orderId;
      logger.info('📥 Order created event received', { orderId });
      await orderReadModel.buildReadModel(orderId);
    });

    orderConsumer.registerHandler('order.updated', async (message) => {
      const orderId = message?.orderId || message?.payload?.orderId;
      logger.info('📥 Order updated event received', { orderId });
      await orderReadModel.buildReadModel(orderId);
    });

    orderConsumer.registerHandler('driver.assigned', async (message) => {
      const orderId = message?.orderId || message?.payload?.orderId;
      logger.info('📥 Driver assigned event received', { orderId });
      await orderReadModel.buildReadModel(orderId);
    });

    orderConsumer.registerHandler('payment.confirmed', async (message) => {
      const orderId = message?.orderId || message?.payload?.orderId;
      logger.info('📥 Payment confirmed event received', { orderId });
      await orderReadModel.buildReadModel(orderId);
    });

    await orderConsumer.startAllConsumers();

    // Relay committed-but-unpublished order_outbox rows to Kafka. The claim
    // RPC leases rows so multiple relay replicas publish each event exactly
    // once, and Kafka being down only delays publication (never loses it).
    startOutboxRelay();

    logger.info('✅ Kafka event-driven services started');

  } catch (error) {
    logger.error('❌ Failed to start Kafka services:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down...');
  stopOutboxRelay();
  await kafka.disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down...');
  stopOutboxRelay();
  await kafka.disconnect();
  process.exit(0);
});

main();
