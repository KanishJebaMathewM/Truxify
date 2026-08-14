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

const { HealthStatus } = await import('../../../../../src/core/health/HealthCheck.js');

async function loadHealthChecks(db) {
  vi.resetModules();
  vi.doMock('../../../../../src/config/db.js', () => db);
  const postgresHealth = (await import('../../../../../src/core/health/checks/postgresHealth.js')).default;
  const redisHealth = (await import('../../../../../src/core/health/checks/redisHealth.js')).default;
  const mongodbHealth = (await import('../../../../../src/core/health/checks/mongodbHealth.js')).default;
  const websocketHealth = (await import('../../../../../src/core/health/checks/websocketHealth.js')).default;
  return { postgresHealth, redisHealth, mongodbHealth, websocketHealth };
}

describe('postgresHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports unhealthy when the pool is not configured', async () => {
    const { postgresHealth } = await loadHealthChecks({ pgPool: null });
    const result = await postgresHealth({ timeoutMs: 100 });
    expect(result.status).toBe(HealthStatus.UNHEALTHY);
    expect(result.message).toBe('not_configured');
  });

  it('reports healthy on a successful query with pool metadata', async () => {
    const pgPool = {
      query: vi.fn().mockResolvedValue({ rows: [{ ok: 1 }] }),
      totalCount: 10,
      idleCount: 4,
    };
    const { postgresHealth } = await loadHealthChecks({ pgPool });
    const result = await postgresHealth({ timeoutMs: 100 });
    expect(result.status).toBe(HealthStatus.HEALTHY);
    expect(result.metadata.poolTotalCount).toBe(10);
  });

  it('reports unhealthy on an unexpected query result', async () => {
    const pgPool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const { postgresHealth } = await loadHealthChecks({ pgPool });
    const result = await postgresHealth({ timeoutMs: 100 });
    expect(result.status).toBe(HealthStatus.UNHEALTHY);
  });

  it('reports unhealthy when the query throws', async () => {
    const pgPool = { query: vi.fn().mockRejectedValue(new Error('connection refused')) };
    const { postgresHealth } = await loadHealthChecks({ pgPool });
    const result = await postgresHealth({ timeoutMs: 100 });
    expect(result.status).toBe(HealthStatus.UNHEALTHY);
  });
});

describe('redisHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports unhealthy when the client is not configured', async () => {
    const { redisHealth } = await loadHealthChecks({ redisClient: null });
    const result = await redisHealth({ timeoutMs: 100 });
    expect(result.status).toBe(HealthStatus.UNHEALTHY);
  });

  it('reports healthy on PONG', async () => {
    const redisClient = { ping: vi.fn().mockResolvedValue('PONG') };
    const { redisHealth } = await loadHealthChecks({ redisClient });
    const result = await redisHealth({ timeoutMs: 100 });
    expect(result.status).toBe(HealthStatus.HEALTHY);
  });

  it('reports unhealthy on an unexpected reply', async () => {
    const redisClient = { ping: vi.fn().mockResolvedValue('PONG?') };
    const { redisHealth } = await loadHealthChecks({ redisClient });
    const result = await redisHealth({ timeoutMs: 100 });
    expect(result.status).toBe(HealthStatus.UNHEALTHY);
  });
});

describe('mongodbHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports unhealthy when Mongo is not configured', async () => {
    const { mongodbHealth } = await loadHealthChecks({ mongoDb: null });
    const result = await mongodbHealth({ timeoutMs: 100 });
    expect(result.status).toBe(HealthStatus.UNHEALTHY);
  });

  it('reports healthy on a successful ping', async () => {
    const mongoDb = { admin: vi.fn(() => ({ ping: vi.fn().mockResolvedValue({ ok: 1 }) })) };
    const { mongodbHealth } = await loadHealthChecks({ mongoDb });
    const result = await mongodbHealth({ timeoutMs: 100 });
    expect(result.status).toBe(HealthStatus.HEALTHY);
  });
});

describe('websocketHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete globalThis.__truxify_wsState;
  });

  it('reports unhealthy when no ws state is registered', async () => {
    const { websocketHealth } = await loadHealthChecks({});
    const result = await websocketHealth({ timeoutMs: 100 });
    expect(result.status).toBe(HealthStatus.UNHEALTHY);
    expect(result.message).toBe('no_websocket_server');
  });

  it('reports healthy when the ws server is active', async () => {
    globalThis.__truxify_wsState = {
      hasWebSocketServer: true,
      hasWsHeartbeatInterval: true,
      isSchedulerActive: true,
      pubSub: { enabled: true, ready: true },
    };
    const { websocketHealth } = await loadHealthChecks({});
    const result = await websocketHealth({ timeoutMs: 100 });
    expect(result.status).toBe(HealthStatus.HEALTHY);
    expect(result.metadata.pubSubReady).toBe(true);
  });

  it('reports unhealthy when the ws server is not running', async () => {
    globalThis.__truxify_wsState = { hasWebSocketServer: false, pubSub: null };
    const { websocketHealth } = await loadHealthChecks({});
    const result = await websocketHealth({ timeoutMs: 100 });
    expect(result.status).toBe(HealthStatus.UNHEALTHY);
  });
});
