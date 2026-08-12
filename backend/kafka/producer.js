/**
 * Kafka Key-Based Telemetry Event Producer
 */
import kafkaConfig, { TOPICS } from './config/kafka.config.js';
import logger from '../api/src/middleware/logger.js';

export class KafkaTelemetryProducer {
  constructor(broker = 'localhost:9092') {
    this.broker = broker;
    this.topic = TOPICS.TELEMETRY_DRIVER_COMPACTED;
  }

  async sendTelemetryEvent(driverId, telemetryPayload) {
    if (!driverId) {
      throw new Error('driverId is required to publish a telemetry event');
    }

    const producer = await kafkaConfig.getProducer();

    const records = await producer.send({
      topic: this.topic,
      messages: [
        {
          key: String(driverId), // Kafka partition key enforcing log compaction
          value: JSON.stringify(telemetryPayload),
          timestamp: Date.now(),
        },
      ],
    });

    if (!records || records.length === 0) {
      throw new Error('Kafka producer returned no record metadata for the published message');
    }

    const { partition, offset, errorCode } = records[0];
    if (errorCode) {
      throw new Error(`Kafka producer reported error code ${errorCode} for topic ${this.topic}`);
    }

    logger.info(`[Kafka Producer] Published compacted state for key ${driverId} to ${this.topic} (partition ${partition}, offset ${offset})`);

    return {
      success: true,
      topic: this.topic,
      partition,
      offset,
    };
  }
}

export const kafkaProducer = new KafkaTelemetryProducer();
