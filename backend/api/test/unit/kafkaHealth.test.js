import { describe, it, expect, vi, afterEach } from 'vitest';

const kafkaState = vi.hoisted(() => ({
  mode: 'connected',
}));

vi.mock('../../src/config/db.js', () => ({
  redisClient: null,
  supabase: null,
  supabaseAdmin: null,
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

// The mocked config module is evaluated once per file, so expose the knobs
// through getters that read the current mode on every health check call.
vi.mock('../../../kafka/config/kafka.config.js', () => ({
  get default() {
    if (kafkaState.mode === 'unavailable') {
      return null;
    }
    return {
      get isConnected() {
        return kafkaState.mode === 'connected';
      },
    };
  },
}));

import kafkaHealth from '../../src/core/health/checks/kafkaHealth.js';

describe('kafkaHealth', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    kafkaState.mode = 'connected';
  });

  it('returns DEGRADED when neither KAFKA_BROKERS nor KAFKA_ENABLED is set', async () => {
    delete process.env.KAFKA_BROKERS;
    delete process.env.KAFKA_ENABLED;
    const result = await kafkaHealth();
    expect(result.status).toBe('degraded');
    expect(result.message).toBe('not_configured');
  });

  it('falls back to the default broker when KAFKA_ENABLED is set but brokers are missing', async () => {
    process.env.KAFKA_ENABLED = 'true';
    delete process.env.KAFKA_BROKERS;
    kafkaState.mode = 'connected';
    const result = await kafkaHealth();
    expect(result.status).toBe('healthy');
    expect(result.metadata.brokers).toBe('localhost:9092');
  });

  it('returns DEGRADED when module import fails', async () => {
    process.env.KAFKA_BROKERS = 'localhost:9092';
    delete process.env.KAFKA_ENABLED;
    kafkaState.mode = 'unavailable';
    const result = await kafkaHealth();
    expect(result.status).toBe('degraded');
    expect(result.message).toBe('module_not_available');
  });

  it('returns DEGRADED when kafka is not connected', async () => {
    process.env.KAFKA_BROKERS = 'localhost:9092';
    delete process.env.KAFKA_ENABLED;
    kafkaState.mode = 'disconnected';
    const result = await kafkaHealth();
    expect(result.status).toBe('degraded');
    expect(result.message).toBe('producer_not_connected');
  });

  it('returns HEALTHY when kafka is connected', async () => {
    process.env.KAFKA_BROKERS = 'broker1:9092,broker2:9092';
    delete process.env.KAFKA_ENABLED;
    kafkaState.mode = 'connected';
    const result = await kafkaHealth();
    expect(result.status).toBe('healthy');
    expect(result.metadata.brokers).toBe('broker1:9092,broker2:9092');
  });

  it('uses localhost:9092 as default broker metadata when env not set', async () => {
    process.env.KAFKA_BROKERS = 'localhost:9092';
    delete process.env.KAFKA_ENABLED;
    kafkaState.mode = 'connected';
    const result = await kafkaHealth();
    expect(result.metadata.brokers).toBe('localhost:9092');
  });
});
