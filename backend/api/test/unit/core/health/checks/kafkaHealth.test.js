import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../../../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

const { mockKafkaState } = vi.hoisted(() => ({
  mockKafkaState: {
    config: {
      isConnected: true,
    },
    shouldThrowOnImport: false,
    importError: new Error('Cannot find module kafka.config.js'),
    delayMs: 0,
  },
}));

vi.mock('../../../../../../kafka/config/kafka.config.js', async () => {
  if (mockKafkaState.delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, mockKafkaState.delayMs));
  }
  if (mockKafkaState.shouldThrowOnImport) {
    throw mockKafkaState.importError;
  }
  return {
    get default() {
      if (mockKafkaState.delayMs > 0) {
        // Return after delay if accessed
      }
      if (mockKafkaState.shouldThrowOnImport) {
        throw mockKafkaState.importError;
      }
      return mockKafkaState.config;
    },
  };
});

import { HealthStatus } from '../../../../../src/core/health/HealthCheck.js';
import kafkaHealth from '../../../../../src/core/health/checks/kafkaHealth.js';

describe('kafkaHealth', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.KAFKA_BROKERS;
    delete process.env.KAFKA_ENABLED;

    mockKafkaState.config = { isConnected: true };
    mockKafkaState.shouldThrowOnImport = false;
    mockKafkaState.importError = new Error('Cannot find module kafka.config.js');
    mockKafkaState.delayMs = 0;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('reports DEGRADED status when Kafka is not configured', async () => {
    const result = await kafkaHealth();

    expect(result.name).toBe('kafka');
    expect(result.status).toBe(HealthStatus.DEGRADED);
    expect(result.message).toBe('not_configured');
    expect(result.critical).toBe(false);
    expect(typeof result.responseTime).toBe('number');
  });

  it('reports HEALTHY status when Kafka broker is configured and connected', async () => {
    process.env.KAFKA_BROKERS = 'kafka1:9092,kafka2:9092';
    mockKafkaState.config.isConnected = true;

    const result = await kafkaHealth();

    expect(result.name).toBe('kafka');
    expect(result.status).toBe(HealthStatus.HEALTHY);
    expect(result.metadata).toEqual({ brokers: 'kafka1:9092,kafka2:9092' });
    expect(result.critical).toBe(false);
    expect(typeof result.responseTime).toBe('number');
  });

  it('reports HEALTHY with default broker address when KAFKA_ENABLED is set but KAFKA_BROKERS is empty', async () => {
    process.env.KAFKA_ENABLED = 'true';
    mockKafkaState.config.isConnected = true;

    const result = await kafkaHealth();

    expect(result.name).toBe('kafka');
    expect(result.status).toBe(HealthStatus.HEALTHY);
    expect(result.metadata).toEqual({ brokers: 'localhost:9092' });
  });

  it('reports DEGRADED when Kafka is configured but producer is not connected', async () => {
    process.env.KAFKA_BROKERS = 'localhost:9092';
    mockKafkaState.config.isConnected = false;

    const result = await kafkaHealth();

    expect(result.name).toBe('kafka');
    expect(result.status).toBe(HealthStatus.DEGRADED);
    expect(result.message).toBe('producer_not_connected');
  });

  it('reports DEGRADED and logs a warning when the kafka config module fails to import', async () => {
    process.env.KAFKA_ENABLED = 'true';
    mockKafkaState.shouldThrowOnImport = true;
    mockKafkaState.importError = new Error('Dynamic import failed');

    const result = await kafkaHealth();

    expect(result.name).toBe('kafka');
    expect(result.status).toBe(HealthStatus.DEGRADED);
    expect(result.message).toBe('module_not_available');
    expect(mockLogger.warn).toHaveBeenCalledWith(
      '[kafkaHealth] Failed to import kafka config:',
      'Dynamic import failed'
    );
  });

  it('supports custom options such as timeoutMs and critical override', async () => {
    process.env.KAFKA_BROKERS = 'localhost:9092';
    mockKafkaState.config.isConnected = true;

    const result = await kafkaHealth({ timeoutMs: 500, critical: true });

    expect(result.name).toBe('kafka');
    expect(result.status).toBe(HealthStatus.HEALTHY);
    expect(result.critical).toBe(true);
  });

  it('reports UNHEALTHY status and logs an error when the check times out', async () => {
    process.env.KAFKA_BROKERS = 'localhost:9092';

    vi.resetModules();
    vi.doMock('../../../../../../kafka/config/kafka.config.js', async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return {
        default: { isConnected: true },
      };
    });

    const { default: freshKafkaHealth } = await import('../../../../../src/core/health/checks/kafkaHealth.js');

    const result = await freshKafkaHealth({ timeoutMs: 20 });

    expect(result.name).toBe('kafka');
    expect(result.status).toBe(HealthStatus.UNHEALTHY);
    expect(result.message).toContain('healthcheck timeout after 20ms');
    expect(mockLogger.error).toHaveBeenCalled();
  });
});
