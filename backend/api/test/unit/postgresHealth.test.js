import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/config/db.js', () => ({
  redisClient: null,
  supabase: null,
  supabaseAdmin: null,
}));

vi.mock('../../../src/core/health/HealthCheck.js', () => ({
  HealthStatus: { HEALTHY: 'healthy', DEGRADED: 'degraded', UNHEALTHY: 'unhealthy' },
  executeCheck: (name, checkFn) => checkFn(),
}));

describe('postgresHealth', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('returns UNHEALTHY when pgPool is not configured', async () => {
    vi.doMock('../../../src/config/db.js', () => ({
      pgPool: null,
      redisClient: null,
      supabase: null,
      supabaseAdmin: null,
    }));
    const { default: postgresHealth } = await import('../../../src/core/health/checks/postgresHealth.js');
    const result = await postgresHealth()();
    expect(result.status).toBe('unhealthy');
    expect(result.message).toBe('not_configured');
  });

  it('returns HEALTHY when pgPool query succeeds', async () => {
    vi.doMock('../../../src/config/db.js', () => ({
      pgPool: { query: vi.fn().mockResolvedValue({ rows: [{ ok: 1 }], totalCount: 5, idleCount: 2 }) },
      redisClient: null,
      supabase: null,
      supabaseAdmin: null,
    }));
    const { default: postgresHealth } = await import('../../../src/core/health/checks/postgresHealth.js');
    const result = await postgresHealth()();
    expect(result.status).toBe('healthy');
    expect(result.metadata.poolTotalCount).toBe(5);
    expect(result.metadata.poolIdleCount).toBe(2);
  });

  it('returns UNHEALTHY when query returns unexpected result', async () => {
    vi.doMock('../../../src/config/db.js', () => ({
      pgPool: { query: vi.fn().mockResolvedValue({ rows: [{}] }) },
      redisClient: null,
      supabase: null,
      supabaseAdmin: null,
    }));
    const { default: postgresHealth } = await import('../../../src/core/health/checks/postgresHealth.js');
    const result = await postgresHealth()();
    expect(result.status).toBe('unhealthy');
    expect(result.message).toBe('unexpected_query_result');
  });
});
