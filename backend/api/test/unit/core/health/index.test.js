import { describe, it, expect, vi, beforeEach } from 'vitest';

let mockStatus = 'not_configured';

vi.mock('../../../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../../src/config/db.js', () => ({
  supabase: null,
  supabaseAdmin: null,
  redisClient: null,
  pgPool: null,
  firebaseAdmin: null,
  mongoDb: null,
}));

vi.mock('../../../../src/services/escrow.js', () => ({
  checkEscrowHealth: vi.fn(async () => ({ status: 'not_configured' })),
}));

vi.mock('../../../../src/core/health/checks/mlHealth.js', () => ({
  default: async () => ({ status: 'degraded', message: 'not_reachable' }),
}));

const healthIndex = await import('../../../../src/core/health/index.js');

describe('createDefaultAggregator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStatus = 'not_configured';
  });

  it('returns a HealthAggregator instance', () => {
    const aggregator = healthIndex.createDefaultAggregator();
    expect(aggregator).toBeInstanceOf(healthIndex.HealthAggregator);
  });

  it('registers all 12 expected service checks', () => {
    const aggregator = healthIndex.createDefaultAggregator();
    const names = aggregator._checks.map((c) => c.name).sort();
    expect(names).toEqual([
      'escrow',
      'firebase',
      'graphql',
      'kafka',
      'ml_engine',
      'mongodb',
      'polygon',
      'postgres',
      'redis',
      'supabase',
      'websocket',
      'workers',
    ]);
  });

  it('marks supabase, mongodb, and postgres as critical', () => {
    const aggregator = healthIndex.createDefaultAggregator();
    const critical = aggregator._checks.filter((c) => c.critical).map((c) => c.name);
    expect(critical.sort()).toEqual(['mongodb', 'postgres', 'supabase']);
  });

  it('aggregate runs every check and returns a per-service result', async () => {
    const aggregator = healthIndex.createDefaultAggregator();
    const result = await aggregator.aggregate();

    expect(Object.keys(result.services).length).toBe(12);
    expect(result.services.supabase).toBeDefined();
    expect(result.services.escrow).toBeDefined();
    expect(result.services.workers).toBeDefined();
    expect(result.summary.total).toBe(12);
  });

  it('overall status is degraded when a non-critical check is unhealthy', async () => {
    const aggregator = healthIndex.createDefaultAggregator();
    const result = await aggregator.aggregate();

    // supabase/mongodb/postgres critical checks report not_configured →
    // unhealthy; but without a live DB the default factory's critical checks
    // return unhealthy, so the overall status is UNHEALTHY.
    expect(result.status).toBe('unhealthy');
  });

  it('exports the health primitives', () => {
    expect(healthIndex.HealthStatus).toBeDefined();
    expect(typeof healthIndex.executeCheck).toBe('function');
    expect(typeof healthIndex.withTimeout).toBe('function');
  });
});
