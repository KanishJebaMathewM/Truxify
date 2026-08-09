import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HealthAggregator } from '../../../src/core/health/HealthAggregator.js';
import { HealthStatus } from '../../../src/core/health/HealthCheck.js';

vi.mock('../../../src/middleware/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

function makeHealthyResult(name = 'test') {
  return {
    name,
    status: HealthStatus.HEALTHY,
    responseTime: 10,
    critical: false,
    timestamp: new Date().toISOString(),
  };
}

function makeUnhealthyResult(name = 'test') {
  return {
    name,
    status: HealthStatus.UNHEALTHY,
    message: 'connection refused',
    responseTime: 50,
    critical: false,
    timestamp: new Date().toISOString(),
  };
}

function makeDegradedResult(name = 'test') {
  return {
    name,
    status: HealthStatus.DEGRADED,
    message: 'slow response',
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

  describe('register()', () => {
    it('registers a check function', () => {
      aggregator.register('svc', () => makeHealthyResult('svc'));
      expect(aggregator._checks).toHaveLength(1);
      expect(aggregator._checks[0].name).toBe('svc');
    });

    it('registers multiple checks', () => {
      aggregator.register('a', () => makeHealthyResult('a'));
      aggregator.register('b', () => makeHealthyResult('b'));
      expect(aggregator._checks).toHaveLength(2);
    });
  });

  describe('aggregate()', () => {
    it('returns healthy when all services are healthy', async () => {
      aggregator.register('supabase', () => makeHealthyResult('supabase'));
      aggregator.register('mongodb', () => makeHealthyResult('mongodb'));
      aggregator.register('redis', () => makeHealthyResult('redis'));

      const result = await aggregator.aggregate();

      expect(result.status).toBe('healthy');
      expect(result.services.supabase.status).toBe('healthy');
      expect(result.services.mongodb.status).toBe('healthy');
      expect(result.services.redis.status).toBe('healthy');
    });

    it('returns degraded when a non-critical service is unhealthy', async () => {
      aggregator.register('supabase', () => makeHealthyResult('supabase'));
      aggregator.register('redis', () => makeUnhealthyResult('redis'));

      const result = await aggregator.aggregate();
      expect(result.status).toBe('degraded');
    });

    it('returns unhealthy when a critical service is unhealthy', async () => {
      aggregator.register('supabase', () => ({
        ...makeHealthyResult('supabase'),
        critical: true,
      }));
      aggregator.register('mongodb', () => ({
        ...makeUnhealthyResult('mongodb'),
        critical: true,
      }));

      const result = await aggregator.aggregate();
      expect(result.status).toBe('unhealthy');
    });

    it('returns unhealthy when any critical service is unhealthy even if others are healthy', async () => {
      aggregator.register('postgres', () => ({
        ...makeUnhealthyResult('postgres'),
        critical: true,
      }));
      aggregator.register('redis', () => makeHealthyResult('redis'));

      const result = await aggregator.aggregate();
      expect(result.status).toBe('unhealthy');
    });

    it('returns degraded when critical is healthy but non-critical is degraded', async () => {
      aggregator.register('supabase', () => ({
        ...makeHealthyResult('supabase'),
        critical: true,
      }));
      aggregator.register('kafka', () => makeDegradedResult('kafka'));

      const result = await aggregator.aggregate();
      expect(result.status).toBe('degraded');
    });

    it('includes summary counts', async () => {
      aggregator.register('a', () => makeHealthyResult('a'));
      aggregator.register('b', () => makeDegradedResult('b'));
      aggregator.register('c', () => makeUnhealthyResult('c'));

      const result = await aggregator.aggregate();
      expect(result.summary).toEqual({
        total: 3,
        healthy: 1,
        degraded: 1,
        unhealthy: 1,
      });
    });

    it('includes uptime and timestamp', async () => {
      aggregator.register('svc', () => makeHealthyResult('svc'));

      const result = await aggregator.aggregate();
      expect(result.uptime).toBeTypeOf('number');
      expect(result.timestamp).toBeDefined();
      expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
    });

    it('includes memory usage in MB', async () => {
      aggregator.register('svc', () => makeHealthyResult('svc'));

      const result = await aggregator.aggregate();
      expect(result.memory).toBeDefined();
      expect(result.memory.unit).toBe('MB');
      expect(result.memory.rss).toBeTypeOf('number');
      expect(result.memory.heapTotal).toBeTypeOf('number');
      expect(result.memory.heapUsed).toBeTypeOf('number');
    });

    it('includes version info', async () => {
      aggregator.register('svc', () => makeHealthyResult('svc'));

      const result = await aggregator.aggregate();
      expect(result.version).toBeDefined();
      expect(result.version.node).toBe(process.version);
    });

    it('includes responseTime for total aggregation', async () => {
      aggregator.register('svc', () => makeHealthyResult('svc'));

      const result = await aggregator.aggregate();
      expect(result.responseTime).toBeGreaterThanOrEqual(0);
    });

    it('returns empty services when no checks registered', async () => {
      const result = await aggregator.aggregate();
      expect(result.services).toEqual({});
      expect(result.summary.total).toBe(0);
    });

    it('runs all checks concurrently', async () => {
      const order = [];
      aggregator.register('slow', () =>
        new Promise((resolve) =>
          setTimeout(() => {
            order.push('slow');
            resolve(makeHealthyResult('slow'));
          }, 10)
        )
      );
      aggregator.register('fast', () => {
        order.push('fast');
        return makeHealthyResult('fast');
      });

      await aggregator.aggregate();
      expect(order).toEqual(['fast', 'slow']);
    });

    it('handles check function throwing an error gracefully', async () => {
      aggregator.register('crasher', () => {
        throw new Error('unexpected error');
      });

      const result = await aggregator.aggregate();
      expect(result.services.crasher.status).toBe(HealthStatus.UNHEALTHY);
      expect(result.services.crasher.message).toBe('unexpected error');
    });

    it('handles mix of healthy, degraded, unhealthy, and throwing checks', async () => {
      aggregator.register('healthy', () => makeHealthyResult('healthy'));
      aggregator.register('degraded', () => makeDegradedResult('degraded'));
      aggregator.register('unhealthy', () => makeUnhealthyResult('unhealthy'));
      aggregator.register('crasher', () => { throw new Error('boom'); });

      const result = await aggregator.aggregate();
      expect(result.summary.total).toBe(4);
      expect(result.summary.healthy).toBe(1);
      expect(result.summary.degraded).toBe(1);
      expect(result.summary.unhealthy).toBe(2);
      expect(result.status).toBe('degraded');
    });

    it('applies registered timeoutMs and marks timed-out checks unhealthy', async () => {
      aggregator.register('slow', () =>
        new Promise((resolve) =>
          setTimeout(() => resolve(makeHealthyResult('slow')), 200)
        ),
        { timeoutMs: 30 }
      );

      const result = await aggregator.aggregate();
      expect(result.services.slow.status).toBe(HealthStatus.UNHEALTHY);
      expect(result.services.slow.message).toMatch(/timeout/);
    });

    it('does not time out checks without a registered timeoutMs', async () => {
      aggregator.register('slow', () =>
        new Promise((resolve) =>
          setTimeout(() => resolve(makeHealthyResult('slow')), 50)
        )
      );

      const result = await aggregator.aggregate();
      expect(result.services.slow.status).toBe(HealthStatus.HEALTHY);
    });

    it('treats a timed-out critical check as critical in overall status', async () => {
      aggregator.register('db', () =>
        new Promise((resolve) =>
          setTimeout(() => resolve(makeHealthyResult('db')), 200)
        ),
        { timeoutMs: 30, critical: true }
      );

      const result = await aggregator.aggregate();
      expect(result.services.db.status).toBe(HealthStatus.UNHEALTHY);
      expect(result.status).toBe('unhealthy');
    });

    it('marks individual response times per service', async () => {
      aggregator.register('svc', () => makeHealthyResult('svc'));

      const result = await aggregator.aggregate();
      expect(result.services.svc.responseTime).toBeGreaterThanOrEqual(0);
    });
  });
});
