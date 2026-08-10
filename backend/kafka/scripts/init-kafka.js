#!/usr/bin/env node

import kafka from '../config/kafka.config.js';
import { TOPICS } from '../config/kafka.config.js';
import logger from '../../api/src/middleware/logger.js';

async function initKafka() {
  try {
    logger.info('🚀 Initializing Kafka...');
    
    // Connect to Kafka
    await kafka.connect();
    logger.info('✅ Kafka connected');
    
    // List topics
    const admin = kafka.kafka.admin();
    await admin.connect();
    
    const topics = await admin.listTopics();
    logger.info(`📋 Existing topics: ${topics.join(', ')}`);
    
    // Create topics if not exist
    const topicsToCreate = Object.values(TOPICS);
    const existingTopics = new Set(topics);
    const newTopics = topicsToCreate.filter(t => !existingTopics.has(t));
    
    if (newTopics.length > 0) {
      await kafka.createTopics();
      logger.info(`✅ Created topics: ${newTopics.join(', ')}`);
    } else {
      logger.info('✅ All topics already exist');
    }
    
    await admin.disconnect();
    
    logger.info('✅ Kafka initialization complete');
    process.exit(0);
  } catch (error) {
    logger.error('❌ Kafka initialization failed:', error);
    process.exit(1);
  }
}

initKafka();