import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

const { HealthAggregator } = await import('../../src/core/health/HealthAggregator.js');

describe('HealthAggregator critical flag propagation', () => {
  it('reports UNHEALTHY overall status when a critical check throws', async () => {
    const aggregator = new HealthAggregator();
    aggregator.register('postgres', async () => {
      throw new Error('connection refused');
    }, { critical: true });

    const result = await aggregator.aggregate();

    expect(result.services.postgres.critical).toBe(true);
    expect(result.services.postgres.status).toBe('unhealthy');
    expect(result.status).toBe('unhealthy');
  });

  it('reports DEGRADED overall status when only a non-critical check fails', async () => {
    const aggregator = new HealthAggregator();
    aggregator.register('redis', async () => {
      throw new Error('timeout');
    }, { critical: false });

    const result = await aggregator.aggregate();

    expect(result.services.redis.critical).toBe(false);
    expect(result.status).toBe('degraded');
  });

  it('propagates the registered critical flag on successful checks', async () => {
    const aggregator = new HealthAggregator();
    aggregator.register('supabase', async () => ({
      status: 'unhealthy',
      message: 'query failed',
    }), { critical: true });

    const result = await aggregator.aggregate();

    expect(result.services.supabase.critical).toBe(true);
    expect(result.status).toBe('unhealthy');
  });
});
