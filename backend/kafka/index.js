import dotenv from 'dotenv';
import kafka from './config/kafka.config.js';
import orderEvents from './events/order.events.js';
import orderConsumer from './consumers/order.consumer.js';
import orderReadModel from './cqrs/order.read.model.js';
import logger from '../api/src/middleware/logger.js';

dotenv.config();

async function main() {
  try {
    logger.info('🚀 Starting Kafka event-driven services...');
    
    // Connect to Kafka
    await kafka.connect();
    
    // Initialize consumers
    await orderConsumer.initialize();
    
    // Register event handlers
    orderConsumer.registerHandler('order.created', async (message) => {
      logger.info('📥 Order created event received', { orderId: message.orderId });
      await orderReadModel.buildReadModel(message.orderId);
    });
    
    orderConsumer.registerHandler('order.updated', async (message) => {
      logger.info('📥 Order updated event received', { orderId: message.orderId });
      await orderReadModel.buildReadModel(message.orderId);
    });
    
    orderConsumer.registerHandler('driver.assigned', async (message) => {
      logger.info('📥 Driver assigned event received', { orderId: message.orderId });
      await orderReadModel.buildReadModel(message.orderId);
    });
    
    orderConsumer.registerHandler('payment.confirmed', async (message) => {
      logger.info('📥 Payment confirmed event received', { orderId: message.orderId });
      await orderReadModel.buildReadModel(message.orderId);
    });
    
    // Start all consumers
    await orderConsumer.startAllConsumers();
    
    logger.info('✅ Kafka event-driven services started');
    
    // Example: Emit test event
    // await orderEvents.emitOrderCreated({
    //   orderId: 'test-123',
    //   customerId: 'customer-456',
    //   total: 5000,
    //   items: ['item1', 'item2'],
    // });
    
  } catch (error) {
    logger.error('❌ Failed to start Kafka services:', error);
    process.exit(1);
  }
}

// Graceful shutdown
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