import { afterEach, describe, expect, it, vi } from 'vitest';
import { HealthAggregator } from '../../src/core/health/HealthAggregator.js';
import { HealthStatus } from '../../src/core/health/HealthCheck.js';
import { CircuitBreaker, CircuitState } from '../../src/lib/circuitBreaker.js';

vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const healthy = (name) => ({
  name,
  status: HealthStatus.HEALTHY,
  responseTime: 10,
  critical: false,
  timestamp: new Date().toISOString(),
});

const unhealthy = (name) => ({
  name,
  status: HealthStatus.UNHEALTHY,
  message: 'connection refused',
  responseTime: 20,
  critical: false,
  timestamp: new Date().toISOString(),
});

describe('HealthAggregator', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('aggregates healthy and unhealthy checks with the correct overall status', async () => {
    const aggregator = new HealthAggregator();
    aggregator.register('database', () => healthy('database'), { critical: true });
    aggregator.register('cache', () => unhealthy('cache'));

    const result = await aggregator.aggregate();

    expect(result.status).toBe(HealthStatus.DEGRADED);
    expect(result.services).toMatchObject({
      database: { name: 'database', status: HealthStatus.HEALTHY, critical: true },
      cache: { name: 'cache', status: HealthStatus.UNHEALTHY, message: 'connection refused' },
    });
    expect(result.summary).toEqual({
      total: 2,
      healthy: 1,
      degraded: 0,
      unhealthy: 1,
    });
  });

  it('reports a critical unhealthy check as an unhealthy aggregation', async () => {
    const aggregator = new HealthAggregator();
    aggregator.register('database', () => unhealthy('database'), { critical: true });

    const result = await aggregator.aggregate();

    expect(result.status).toBe(HealthStatus.UNHEALTHY);
    expect(result.services.database.critical).toBe(true);
  });

  it('marks a check unhealthy when its registered timeout expires', async () => {
    const aggregator = new HealthAggregator();
    aggregator.register(
      'slow-service',
      () => new Promise((resolve) => setTimeout(() => resolve(healthy('slow-service')), 50)),
      { timeoutMs: 10 },
    );

    const result = await aggregator.aggregate();

    expect(result.services['slow-service']).toMatchObject({
      status: HealthStatus.UNHEALTHY,
      message: 'healthcheck timeout after 10ms',
    });
  });

  it('converts an open circuit breaker into an unhealthy service result', async () => {
    const breaker = new CircuitBreaker('health-check', {
      failureThreshold: 1,
      requestTimeoutMs: 100,
    });
    const aggregator = new HealthAggregator();
    const check = vi.fn().mockRejectedValue(new Error('dependency unavailable'));
    aggregator.register('dependency', () => breaker.execute(check), { critical: true });

    const firstResult = await aggregator.aggregate();
    const secondResult = await aggregator.aggregate();

    expect(firstResult.services.dependency.status).toBe(HealthStatus.UNHEALTHY);
    expect(secondResult.services.dependency).toMatchObject({
      status: HealthStatus.UNHEALTHY,
      message: 'CircuitBreaker:health-check is OPEN',
      critical: true,
    });
    expect(breaker.state).toBe(CircuitState.OPEN);
    expect(check).toHaveBeenCalledTimes(1);

    breaker.destroy();
  });

  it('formats the aggregated response with service, summary, timing, memory, and version data', async () => {
    const aggregator = new HealthAggregator();
    aggregator.register('api', () => healthy('api'));

    const result = await aggregator.aggregate();

    expect(result).toMatchObject({
      status: HealthStatus.HEALTHY,
      services: { api: expect.objectContaining({ status: HealthStatus.HEALTHY }) },
      summary: { total: 1, healthy: 1, degraded: 0, unhealthy: 0 },
      version: { node: process.version },
      memory: {
        rss: expect.any(Number),
        heapTotal: expect.any(Number),
        heapUsed: expect.any(Number),
        external: expect.any(Number),
        unit: 'MB',
      },
    });
    expect(result.timestamp).toBe(new Date(result.timestamp).toISOString());
    expect(result.responseTime).toBeGreaterThanOrEqual(0);
    expect(result.uptime).toBeTypeOf('number');
  });
});
