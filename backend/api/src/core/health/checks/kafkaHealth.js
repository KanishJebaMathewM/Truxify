import { HealthStatus, executeCheck } from '../HealthCheck.js';
import logger from '../../../middleware/logger.js';

const NAME = 'kafka';
const KAFKA_HEALTH_TIMEOUT_MS = 3000;

async function check() {
  if (!process.env.KAFKA_BROKERS && !process.env.KAFKA_ENABLED) {
    return { status: HealthStatus.DEGRADED, message: 'not_configured' };
  }

  try {
    const { default: kafkaConfig } = await import('../../../../../kafka/config/kafka.config.js');
    if (kafkaConfig.isConnected) {
      return {
        status: HealthStatus.HEALTHY,
        metadata: { brokers: process.env.KAFKA_BROKERS || 'localhost:9092' },
      };
    }
    return { status: HealthStatus.DEGRADED, message: 'producer_not_connected' };
  } catch (err) {
    logger.warn('[kafkaHealth] Failed to import kafka config:', err?.message);
    return { status: HealthStatus.DEGRADED, message: 'module_not_available' };
  }
} // <-- This closing brace was missing

export default function kafkaHealth(opts) {
  return executeCheck(NAME, check, {
    critical: false,
    timeoutMs: KAFKA_HEALTH_TIMEOUT_MS,
    ...opts,
  });
}