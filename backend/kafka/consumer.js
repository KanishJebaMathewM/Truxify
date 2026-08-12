/**
 * Kafka Log-Compacted Topic Telemetry Consumer Group
 */
import kafkaConfig, { TOPICS } from './config/kafka.config.js';
import logger from '../api/src/middleware/logger.js';

export class KafkaTelemetryConsumer {
  constructor(groupId = 'truxify-telemetry-group') {
    this.groupId = groupId;
    this.topic = TOPICS.TELEMETRY_DRIVER_COMPACTED;
    this.consumer = null;
  }

  async startListening(onMessageCallback) {
    if (typeof onMessageCallback !== 'function') {
      throw new Error('onMessageCallback is required to consume telemetry events');
    }

    const consumer = await kafkaConfig.createConsumer(this.groupId, [this.topic]);
    this.consumer = consumer;

    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        const key = message.key ? message.key.toString() : null;
        let value = null;
        try {
          value = JSON.parse(message.value.toString());
        } catch {
          value = message.value.toString();
        }

        await onMessageCallback(value, {
          key,
          partition,
          topic,
          timestamp: Number(message.timestamp),
        });
      },
    });

    logger.info(`[Kafka Consumer] Listening to ${this.topic} in group ${this.groupId}`);
    return consumer;
  }

  async stopListening() {
    if (this.consumer) {
      await this.consumer.disconnect();
      this.consumer = null;
    }
  }
}

export const kafkaConsumer = new KafkaTelemetryConsumer();
