import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/config/db.js', () => ({
  redisClient: null,
  supabase: null,
  supabaseAdmin: null,
}));

vi.mock('../../../src/middleware/logger.js', () => ({
  default: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('../../../src/core/health/HealthCheck.js', () => ({
  HealthStatus: { HEALTHY: 'healthy', DEGRADED: 'degraded', UNHEALTHY: 'unhealthy' },
  executeCheck: (name, checkFn) => checkFn(),
}));

describe('kafkaHealth', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it('returns DEGRADED when neither KAFKA_BROKERS nor KAFKA_ENABLED is set', async () => {
    delete process.env.KAFKA_BROKERS;
    delete process.env.KAFKA_ENABLED;
    const { default: kafkaHealth } = await import('../../../src/core/health/checks/kafkaHealth.js');
    const result = await kafkaHealth()();
    expect(result.status).toBe('degraded');
    expect(result.message).toBe('not_configured');
  });

  it('returns DEGRADED when KAFKA_ENABLED is set but brokers are missing', async () => {
    process.env.KAFKA_ENABLED = 'true';
    delete process.env.KAFKA_BROKERS;
    const { default: kafkaHealth } = await import('../../../src/core/health/checks/kafkaHealth.js');
    const result = await kafkaHealth()();
    expect(result.status).toBe('degraded');
    expect(result.message).toBe('not_configured');
  });

  it('returns DEGRADED when module import fails', async () => {
    process.env.KAFKA_BROKERS = 'localhost:9092';
    delete process.env.KAFKA_ENABLED;
    vi.mock('../../../../kafka/config/kafka.config.js', () => {
      throw new Error('module unavailable');
    });
    const { default: kafkaHealth } = await import('../../../src/core/health/checks/kafkaHealth.js');
    const result = await kafkaHealth()();
    expect(result.status).toBe('degraded');
    expect(result.message).toBe('module_not_available');
  });

  it('returns DEGRADED when kafka is not connected', async () => {
    process.env.KAFKA_BROKERS = 'localhost:9092';
    delete process.env.KAFKA_ENABLED;
    vi.mock('../../../../kafka/config/kafka.config.js', () => ({
      default: { isConnected: false },
    }));
    const { default: kafkaHealth } = await import('../../../src/core/health/checks/kafkaHealth.js');
    const result = await kafkaHealth()();
    expect(result.status).toBe('degraded');
    expect(result.message).toBe('producer_not_connected');
  });

  it('returns HEALTHY when kafka is connected', async () => {
    process.env.KAFKA_BROKERS = 'broker1:9092,broker2:9092';
    delete process.env.KAFKA_ENABLED;
    vi.mock('../../../../kafka/config/kafka.config.js', () => ({
      default: { isConnected: true },
    }));
    const { default: kafkaHealth } = await import('../../../src/core/health/checks/kafkaHealth.js');
    const result = await kafkaHealth()();
    expect(result.status).toBe('healthy');
    expect(result.metadata.brokers).toBe('broker1:9092,broker2:9092');
  });

  it('uses localhost:9092 as default broker metadata when env not set', async () => {
    process.env.KAFKA_BROKERS = 'localhost:9092';
    delete process.env.KAFKA_ENABLED;
    vi.mock('../../../../kafka/config/kafka.config.js', () => ({
      default: { isConnected: true },
    }));
    const { default: kafkaHealth } = await import('../../../src/core/health/checks/kafkaHealth.js');
    const result = await kafkaHealth()();
    expect(result.metadata.brokers).toBe('localhost:9092');
  });
});
