import { HealthStatus, executeCheck } from '../HealthCheck.js';

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
  } catch {
    return { status: HealthStatus.DEGRADED, message: 'module_not_available' };
  }
}

export default function kafkaHealth(opts) {
  return executeCheck(NAME, check, { critical: false, timeoutMs: KAFKA_HEALTH_TIMEOUT_MS, ...opts });
}
