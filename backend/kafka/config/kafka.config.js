import { Kafka } from 'kafkajs';
import logger from '../../api/src/middleware/logger.js';

const kafka = new Kafka({
  clientId: 'truxify',
  brokers: process.env.KAFKA_BROKERS ? process.env.KAFKA_BROKERS.split(',') : ['localhost:9092'],
  retry: {
    initialRetryTime: 100,
    retries: 10,
    maxRetryTime: 30000,
  },
  connectionTimeout: 30000,
  requestTimeout: 25000,
});

// Topics
export const TOPICS = {
  ORDER_CREATED: 'order.created',
  ORDER_UPDATED: 'order.updated',
  ORDER_CANCELLED: 'order.cancelled',
  DRIVER_ASSIGNED: 'driver.assigned',
  DRIVER_UPDATED: 'driver.updated',
  PAYMENT_CONFIRMED: 'payment.confirmed',
  PAYMENT_RELEASED: 'payment.released',
  ESCROW_CREATED: 'escrow.created',
  ESCROW_RELEASED: 'escrow.released',
  TRIP_STARTED: 'trip.started',
  TRIP_COMPLETED: 'trip.completed',
  NOTIFICATION_SENT: 'notification.sent',
  FRAUD_DETECTED: 'fraud.detected',
  ETA_UPDATED: 'eta.updated',
  LOCATION_UPDATED: 'location.updated',
};

export const CONSUMER_GROUPS = {
  ORDER_SERVICE: 'order-service',
  DRIVER_SERVICE: 'driver-service',
  PAYMENT_SERVICE: 'payment-service',
  NOTIFICATION_SERVICE: 'notification-service',
  ANALYTICS_SERVICE: 'analytics-service',
  FRAUD_SERVICE: 'fraud-service',
  ESCROW_SERVICE: 'escrow-service',
};

class KafkaConfig {
  constructor() {
    this.producer = null;
    this.consumers = new Map();
    this.isConnected = false;
  }

  async connect() {
    if (this.isConnected) return;
    
    try {
      this.producer = kafka.producer({
        allowAutoTopicCreation: true,
        transactionTimeout: 30000,
      });
      await this.producer.connect();
      this.isConnected = true;
      logger.info('✅ Kafka producer connected');
      
      // Create topics
      await this.createTopics();
    } catch (error) {
      logger.error('❌ Kafka connection failed:', error);
      throw error;
    }
  }

  async createTopics() {
    const admin = kafka.admin();
    await admin.connect();
    
    const topics = Object.values(TOPICS).map(topic => ({
      topic,
      numPartitions: 3,
      replicationFactor: 1,
      configEntries: [
        { name: 'retention.ms', value: '604800000' }, // 7 days
        { name: 'cleanup.policy', value: 'delete' },
        { name: 'delete.retention.ms', value: '604800000' },
      ],
    }));
    
    await admin.createTopics({
      topics,
      validateOnly: false,
    });
    
    await admin.disconnect();
    logger.info('✅ Kafka topics created');
  }

  async getProducer() {
    if (!this.isConnected) {
      await this.connect();
    }
    return this.producer;
  }

  async createConsumer(groupId, topics) {
    const consumer = kafka.consumer({
      groupId,
      maxBytesPerPartition: 10485760, // 10MB
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
      maxPollInterval: 300000,
    });
    
    await consumer.connect();
    await consumer.subscribe({ topics, fromBeginning: false });
    
    this.consumers.set(groupId, consumer);
    logger.info(`✅ Consumer ${groupId} connected`);
    return consumer;
  }

  async getConsumer(groupId) {
    if (!this.consumers.has(groupId)) {
      throw new Error(`Consumer ${groupId} not found`);
    }
    return this.consumers.get(groupId);
  }

  async publishEvent(topic, event, key = null) {
    try {
      const producer = await this.getProducer();
      const message = {
        topic,
        messages: [
          {
            key: key || event.eventId || event.orderId,
            value: JSON.stringify({
              ...event,
              timestamp: event.timestamp || new Date().toISOString(),
              version: '1.0',
            }),
            timestamp: Date.now(),
          },
        ],
      };
      
      await producer.send(message);
      logger.info(`📤 Event published: ${topic}`, { eventId: event.eventId });
      return message;
    } catch (error) {
      logger.error(`❌ Failed to publish event to ${topic}:`, error);
      throw error;
    }
  }

  async publishBatch(events) {
    try {
      const producer = await this.getProducer();
      const messages = events.map(({ topic, event, key }) => ({
        topic,
        messages: [
          {
            key: key || event.eventId,
            value: JSON.stringify({
              ...event,
              timestamp: event.timestamp || new Date().toISOString(),
              version: '1.0',
            }),
            timestamp: Date.now(),
          },
        ],
      }));
      
      await producer.sendBatch({ messages });
      logger.info(`📤 Batch events published: ${events.length} events`);
      return messages;
    } catch (error) {
      logger.error('❌ Failed to publish batch events:', error);
      throw error;
    }
  }

  async consumeMessages(groupId, messageHandler, errorHandler) {
    const consumer = await this.getConsumer(groupId);
    
    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        try {
          const value = JSON.parse(message.value.toString());
          logger.debug(`📥 Message received: ${topic}`, { key: message.key.toString() });
          await messageHandler(topic, value, message);
        } catch (error) {
          logger.error(`❌ Error processing message from ${topic}:`, error);
          if (errorHandler) {
            await errorHandler(error, topic, message);
          }
        }
      },
      eachBatch: async ({ batch }) => {
        // Handle batch processing if needed
        logger.debug(`📦 Batch received: ${batch.topic}, ${batch.messages.length} messages`);
      },
    });
  }

  async disconnect() {
    if (this.producer) {
      await this.producer.disconnect();
    }
    for (const [groupId, consumer] of this.consumers) {
      await consumer.disconnect();
      logger.info(`Consumer ${groupId} disconnected`);
    }
    this.isConnected = false;
    logger.info('✅ Kafka disconnected');
  }

  async getConsumerGroupOffsets(groupId) {
    const admin = kafka.admin();
    await admin.connect();
    
    const offsets = await admin.listConsumerGroupOffsets(groupId);
    await admin.disconnect();
    return offsets;
  }

  parsePartitionId(partition) {
    if (!/^\d+$/.test(String(partition))) {
      throw new Error(`Invalid Kafka partition id: ${partition}`);
    }
    const parsed = Number(partition);
    if (!Number.isSafeInteger(parsed)) {
      throw new Error(`Invalid Kafka partition id: ${partition}`);
    }
    return parsed;
  }

  async resetConsumerOffsets(groupId, topic) {
    const admin = kafka.admin();
    await admin.connect();
    try {
      const offsets = await admin.listConsumerGroupOffsets(groupId);
      const partitions = Object.keys(offsets[topic] || {});
      
      for (const partition of partitions) {
        const parsed = this.parsePartitionId(partition);
        await admin.setConsumerGroupOffset(
          groupId,
          { topic, partition: parsed },
          'latest'
        );
      }
      
      logger.info(`✅ Consumer offsets reset for ${groupId}`);
    } finally {
      await admin.disconnect();
    }
  }
}

export default new KafkaConfig();
