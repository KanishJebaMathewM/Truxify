import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/config/db.js', () => ({
  pgPool: null,
  supabase: null,
  supabaseAdmin: null,
}));

vi.mock('../../../src/core/health/HealthCheck.js', () => ({
  HealthStatus: { HEALTHY: 'healthy', DEGRADED: 'degraded', UNHEALTHY: 'unhealthy' },
  executeCheck: (name, checkFn) => checkFn(),
}));

describe('redisHealth', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('returns UNHEALTHY when redisClient is not configured', async () => {
    vi.doMock('../../../src/config/db.js', () => ({
      pgPool: null,
      redisClient: null,
      supabase: null,
      supabaseAdmin: null,
    }));
    const { default: redisHealth } = await import('../../../src/core/health/checks/redisHealth.js');
    const result = await redisHealth()();
    expect(result.status).toBe('unhealthy');
    expect(result.message).toBe('not_configured');
  });

  it('returns HEALTHY when redis ping returns PONG', async () => {
    vi.doMock('../../../src/config/db.js', () => ({
      pgPool: null,
      redisClient: { ping: vi.fn().mockResolvedValue('PONG') },
      supabase: null,
      supabaseAdmin: null,
    }));
    const { default: redisHealth } = await import('../../../src/core/health/checks/redisHealth.js');
    const result = await redisHealth()();
    expect(result.status).toBe('healthy');
  });

  it('returns UNHEALTHY when redis ping returns unexpected reply', async () => {
    vi.doMock('../../../src/config/db.js', () => ({
      pgPool: null,
      redisClient: { ping: vi.fn().mockResolvedValue('ERROR') },
      supabase: null,
      supabaseAdmin: null,
    }));
    const { default: redisHealth } = await import('../../../src/core/health/checks/redisHealth.js');
    const result = await redisHealth()();
    expect(result.status).toBe('unhealthy');
    expect(result.message).toContain('unexpected reply');
  });
});
