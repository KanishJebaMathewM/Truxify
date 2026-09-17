import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../../../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

const { mockPgState } = vi.hoisted(() => ({
  mockPgState: {
    pgPool: {
      query: vi.fn(),
      totalCount: 10,
      idleCount: 5,
    },
  },
}));

vi.mock('../../../../../src/config/db.js', () => ({
  get pgPool() {
    return mockPgState.pgPool;
  },
}));

import { HealthStatus } from '../../../../../src/core/health/HealthCheck.js';
import postgresHealth from '../../../../../src/core/health/checks/postgresHealth.js';

describe('postgresHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPgState.pgPool = {
      query: vi.fn().mockResolvedValue({ rows: [{ ok: 1 }] }),
      totalCount: 10,
      idleCount: 5,
    };
  });

  it('reports healthy state when PostgreSQL database is reachable and query succeeds', async () => {
    mockPgState.pgPool.query.mockResolvedValue({ rows: [{ ok: 1 }] });

    const result = await postgresHealth();

    expect(result.name).toBe('postgres');
    expect(result.status).toBe(HealthStatus.HEALTHY);
    expect(result.critical).toBe(true);
    expect(typeof result.responseTime).toBe('number');
    expect(result.metadata).toEqual({
      poolTotalCount: 10,
      poolIdleCount: 5,
    });
    expect(mockPgState.pgPool.query).toHaveBeenCalledWith('SELECT 1 AS ok');
  });

  it('reports unhealthy state when PostgreSQL pool is not configured', async () => {
    mockPgState.pgPool = null;

    const result = await postgresHealth();

    expect(result.name).toBe('postgres');
    expect(result.status).toBe(HealthStatus.UNHEALTHY);
    expect(result.message).toBe('not_configured');
    expect(result.critical).toBe(true);
  });

  it('reports unhealthy state when the query returns an unexpected result', async () => {
    mockPgState.pgPool.query.mockResolvedValue({ rows: [] });

    const result = await postgresHealth();

    expect(result.name).toBe('postgres');
    expect(result.status).toBe(HealthStatus.UNHEALTHY);
    expect(result.message).toBe('unexpected query result');
  });

  it('reports unhealthy state when query returns a row without truthy ok', async () => {
    mockPgState.pgPool.query.mockResolvedValue({ rows: [{ ok: 0 }] });

    const result = await postgresHealth();

    expect(result.name).toBe('postgres');
    expect(result.status).toBe(HealthStatus.UNHEALTHY);
    expect(result.message).toBe('unexpected query result');
  });

  it('reports unhealthy state and logs an error when database connection fails or query throws', async () => {
    mockPgState.pgPool.query.mockRejectedValue(new Error('connection refused at 5432'));

    const result = await postgresHealth();

    expect(result.name).toBe('postgres');
    expect(result.status).toBe(HealthStatus.UNHEALTHY);
    expect(result.message).toContain('connection refused at 5432');
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('[health] Check failed: postgres — connection refused at 5432')
    );
  });

  it('reports unhealthy state and logs an error when the query times out', async () => {
    mockPgState.pgPool.query.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ rows: [{ ok: 1 }] }), 100))
    );

    const result = await postgresHealth({ timeoutMs: 20 });

    expect(result.name).toBe('postgres');
    expect(result.status).toBe(HealthStatus.UNHEALTHY);
    expect(result.message).toContain('healthcheck timeout after 20ms');
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('supports custom options such as critical override and timeoutMs', async () => {
    mockPgState.pgPool.query.mockResolvedValue({ rows: [{ ok: 1 }] });

    const result = await postgresHealth({ timeoutMs: 500, critical: false });

    expect(result.name).toBe('postgres');
    expect(result.status).toBe(HealthStatus.HEALTHY);
    expect(result.critical).toBe(false);
  });
});
