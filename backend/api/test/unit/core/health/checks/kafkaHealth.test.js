import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mutable kafka configuration shared with the mocked module so individual
// tests can flip connection state without re-mocking.
const { kafkaConfigState } = vi.hoisted(() => ({
  kafkaConfigState: { isConnected: true },
}));

// The module dynamically imports the kafka config relative to itself. The
// matching specifier from this test file resolves to the same module id.
vi.mock('../../../../../../kafka/config/kafka.config.js', () => ({
  default: kafkaConfigState,
}));

// HealthCheck is imported by the module relative to src/core/health.
vi.mock('../../../../../src/core/health/HealthCheck.js', () => ({
  HealthStatus: { HEALTHY: 'healthy', DEGRADED: 'degraded', DOWN: 'down' },
  executeCheck: async (name, checkFn, opts) => ({
    name,
    ...(await checkFn()),
    ...opts,
  }),
}));

import kafkaHealth from '../../src/core/health/checks/kafkaHealth.js';

describe('kafkaHealth', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.KAFKA_BROKERS;
    delete process.env.KAFKA_ENABLED;
    kafkaConfigState.isConnected = true;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('reports DEGRADED when kafka is not configured', async () => {
    const result = await kafkaHealth();
    expect(result.status).toBe('degraded');
    expect(result.message).toBe('not_configured');
  });

  it('reports HEALTHY when the broker is connected', async () => {
    process.env.KAFKA_BROKERS = 'localhost:9092';
    kafkaConfigState.isConnected = true;
    const result = await kafkaHealth();
    expect(result.status).toBe('healthy');
    expect(result.metadata.brokers).toBe('localhost:9092');
  });

  it('reports DEGRADED when the producer is not connected', async () => {
    process.env.KAFKA_BROKERS = 'localhost:9092';
    kafkaConfigState.isConnected = false;
    const result = await kafkaHealth();
    expect(result.status).toBe('degraded');
    expect(result.message).toBe('producer_not_connected');
  });

  it('reports DEGRADED when KAFKA_ENABLED is set but the module is unavailable', async () => {
    process.env.KAFKA_ENABLED = 'true';
    kafkaConfigState.isConnected = false;
    const result = await kafkaHealth();
    expect(result.status).toBe('degraded');
  });

  it('passes the configured timeout to the health check executor', async () => {
    process.env.KAFKA_BROKERS = 'localhost:9092';
    const result = await kafkaHealth();
    expect(result.timeoutMs).toBe(3000);
  });
});
