import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HealthAggregator } from '../../src/core/health/HealthAggregator.js';
import { HealthStatus } from '../../src/core/health/HealthCheck.js';

vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

function makeHealthyResult(name = 'test', metadata = {}) {
  return {
    name,
    status: HealthStatus.HEALTHY,
    metadata,
    responseTime: 10,
    critical: false,
    timestamp: new Date().toISOString(),
  };
}

function makeUnhealthyResult(name = 'test', message = 'connection failed') {
  return {
    name,
    status: HealthStatus.UNHEALTHY,
    message,
    responseTime: 50,
    critical: false,
    timestamp: new Date().toISOString(),
  };
}

function makeDegradedResult(name = 'test', message = 'high latency / circuit open') {
  return {
    name,
    status: HealthStatus.DEGRADED,
    message,
    metadata: { circuitBreaker: 'OPEN', failures: 5 },
    responseTime: 600,
    critical: false,
    timestamp: new Date().toISOString(),
  };
}

describe('HealthAggregator', () => {
  let aggregator;

  beforeEach(() => {
    aggregator = new HealthAggregator();
  });

  describe('Registration & Basic Aggregation', () => {
    it('registers health check functions with options', () => {
      aggregator.register('db', () => makeHealthyResult('db'), { critical: true, timeoutMs: 500 });
      expect(aggregator._checks).toHaveLength(1);
      expect(aggregator._checks[0]).toMatchObject({
        name: 'db',
        critical: true,
        timeoutMs: 500,
      });
    });

    it('returns HEALTHY when all registered checks pass', async () => {
      aggregator.register('supabase', async () => makeHealthyResult('supabase'));
      aggregator.register('redis', async () => makeHealthyResult('redis'));
      aggregator.register('mongodb', async () => makeHealthyResult('mongodb'));

      const result = await aggregator.aggregate();

      expect(result.status).toBe(HealthStatus.HEALTHY);
      expect(result.summary).toEqual({
        total: 3,
        healthy: 3,
        degraded: 0,
        unhealthy: 0,
      });
      expect(result.services.supabase.status).toBe(HealthStatus.HEALTHY);
      expect(result.services.redis.status).toBe(HealthStatus.HEALTHY);
      expect(result.services.mongodb.status).toBe(HealthStatus.HEALTHY);
    });

    it('returns DEGRADED when a non-critical check is unhealthy', async () => {
      aggregator.register('supabase', async () => makeHealthyResult('supabase'), { critical: true });
      aggregator.register('redis', async () => makeUnhealthyResult('redis', 'redis ping timeout'), { critical: false });

      const result = await aggregator.aggregate();

      expect(result.status).toBe(HealthStatus.DEGRADED);
      expect(result.summary.healthy).toBe(1);
      expect(result.summary.unhealthy).toBe(1);
      expect(result.services.redis.status).toBe(HealthStatus.UNHEALTHY);
    });

    it('returns UNHEALTHY when a critical check is unhealthy', async () => {
      aggregator.register('postgres', async () => ({
        ...makeUnhealthyResult('postgres', 'database unreachable'),
        critical: true,
      }), { critical: true });
      aggregator.register('redis', async () => makeHealthyResult('redis'));

      const result = await aggregator.aggregate();

      expect(result.status).toBe(HealthStatus.UNHEALTHY);
      expect(result.services.postgres.status).toBe(HealthStatus.UNHEALTHY);
      expect(result.summary.unhealthy).toBe(1);
    });
  });

  describe('Circuit Breaker & Degraded Subsystem Integration', () => {
    it('returns DEGRADED when a subsystem reports degraded status due to an open circuit breaker', async () => {
      aggregator.register('paymentGateway', async () => makeDegradedResult('paymentGateway', 'Circuit breaker OPEN'));
      aggregator.register('db', async () => makeHealthyResult('db'));

      const result = await aggregator.aggregate();

      expect(result.status).toBe(HealthStatus.DEGRADED);
      expect(result.summary.degraded).toBe(1);
      expect(result.services.paymentGateway.status).toBe(HealthStatus.DEGRADED);
      expect(result.services.paymentGateway.metadata).toEqual({ circuitBreaker: 'OPEN', failures: 5 });
    });

    it('handles multiple circuit breakers in mixed states', async () => {
      aggregator.register('escrowContract', async () => ({
        name: 'escrowContract',
        status: HealthStatus.DEGRADED,
        metadata: { circuitBreaker: 'HALF_OPEN', retryCount: 2 },
        responseTime: 400,
        critical: false,
        timestamp: new Date().toISOString(),
      }));
      aggregator.register('mlEngine', async () => ({
        name: 'mlEngine',
        status: HealthStatus.UNHEALTHY,
        metadata: { circuitBreaker: 'OPEN', thresholdExceeded: true },
        responseTime: 120,
        critical: false,
        timestamp: new Date().toISOString(),
      }));
      aggregator.register('coreDb', async () => makeHealthyResult('coreDb'));

      const result = await aggregator.aggregate();

      expect(result.status).toBe(HealthStatus.DEGRADED);
      expect(result.summary.total).toBe(3);
      expect(result.summary.healthy).toBe(1);
      expect(result.summary.degraded).toBe(1);
      expect(result.summary.unhealthy).toBe(1);
    });
  });

  describe('Timeout Behavior', () => {
    it('marks a slow check as UNHEALTHY when it exceeds the registered timeoutMs', async () => {
      aggregator.register(
        'slowExternalApi',
        () => new Promise((resolve) => setTimeout(() => resolve(makeHealthyResult('slowExternalApi')), 200)),
        { timeoutMs: 30 }
      );

      const result = await aggregator.aggregate();

      expect(result.services.slowExternalApi.status).toBe(HealthStatus.UNHEALTHY);
      expect(result.services.slowExternalApi.message).toMatch(/timeout/);
    });

    it('treats a timed-out critical check as critical failure leading to UNHEALTHY overall status', async () => {
      aggregator.register(
        'criticalDatabase',
        () => new Promise((resolve) => setTimeout(() => resolve(makeHealthyResult('criticalDatabase')), 200)),
        { critical: true, timeoutMs: 30 }
      );
      aggregator.register('cache', async () => makeHealthyResult('cache'));

      const result = await aggregator.aggregate();

      expect(result.status).toBe(HealthStatus.UNHEALTHY);
      expect(result.services.criticalDatabase.status).toBe(HealthStatus.UNHEALTHY);
      expect(result.services.criticalDatabase.critical).toBe(true);
    });

    it('does not time out fast checks within the timeout threshold', async () => {
      aggregator.register(
        'fastService',
        () => new Promise((resolve) => setTimeout(() => resolve(makeHealthyResult('fastService')), 10)),
        { timeoutMs: 100 }
      );

      const result = await aggregator.aggregate();

      expect(result.services.fastService.status).toBe(HealthStatus.HEALTHY);
    });
  });

  describe('Error Handling & Concurrency', () => {
    it('catches synchronous and asynchronous exceptions from checkFn and marks check UNHEALTHY', async () => {
      aggregator.register('throwingService', async () => {
        throw new Error('Database connection reset by peer');
      });

      const result = await aggregator.aggregate();

      expect(result.services.throwingService.status).toBe(HealthStatus.UNHEALTHY);
      expect(result.services.throwingService.message).toBe('Database connection reset by peer');
      expect(result.services.throwingService.responseTime).toBeGreaterThanOrEqual(0);
    });

    it('executes multiple checks concurrently without blocking', async () => {
      const executionOrder = [];

      aggregator.register('slowCheck', () =>
        new Promise((resolve) =>
          setTimeout(() => {
            executionOrder.push('slowCheck');
            resolve(makeHealthyResult('slowCheck'));
          }, 25)
        )
      );

      aggregator.register('fastCheck', () => {
        executionOrder.push('fastCheck');
        return Promise.resolve(makeHealthyResult('fastCheck'));
      });

      await aggregator.aggregate();

      expect(executionOrder).toEqual(['fastCheck', 'slowCheck']);
    });
  });

  describe('Aggregated Response Formatting', () => {
    it('produces properly formatted AggregatedHealthResponse matching schema', async () => {
      aggregator.register('authService', async () => makeHealthyResult('authService'));

      const result = await aggregator.aggregate();

      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('responseTime');
      expect(result).toHaveProperty('uptime');
      expect(result).toHaveProperty('version');
      expect(result).toHaveProperty('memory');
      expect(result).toHaveProperty('services');
      expect(result).toHaveProperty('summary');

      expect(typeof result.status).toBe('string');
      expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
      expect(typeof result.responseTime).toBe('number');
      expect(typeof result.uptime).toBe('number');

      expect(result.version).toMatchObject({
        node: process.version,
      });

      expect(result.memory).toMatchObject({
        unit: 'MB',
      });
      expect(typeof result.memory.rss).toBe('number');
      expect(typeof result.memory.heapTotal).toBe('number');
      expect(typeof result.memory.heapUsed).toBe('number');
      expect(typeof result.memory.external).toBe('number');

      expect(result.summary).toEqual({
        total: 1,
        healthy: 1,
        degraded: 0,
        unhealthy: 0,
      });
    });

    it('returns empty services object and 0 counts when no checks are registered', async () => {
      const result = await aggregator.aggregate();

      expect(result.status).toBe(HealthStatus.HEALTHY);
      expect(result.services).toEqual({});
      expect(result.summary).toEqual({
        total: 0,
        healthy: 0,
        degraded: 0,
        unhealthy: 0,
      });
    });
  });
});

