import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

let mockSupabase = null;
let mockMongoDb = null;
let mockRedisClient = null;
let mockFirebaseAdmin = null;
let mockPgPool = null;

vi.mock('../../src/config/db.js', () => ({
  get supabase() { return mockSupabase; },
  get mongoDb() { return mockMongoDb; },
  get redisClient() { return mockRedisClient; },
  get firebaseAdmin() { return mockFirebaseAdmin; },
  get pgPool() { return mockPgPool; },
}));

const loggerErrorSpy = vi.fn();
const loggerWarnSpy = vi.fn();
vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    error: (...args) => loggerErrorSpy(...args),
    warn: (...args) => loggerWarnSpy(...args),
    info: vi.fn(),
    debug: vi.fn(),
  }
}));

vi.mock('../../src/services/escrow.js', () => ({
  checkEscrowHealth: vi.fn().mockResolvedValue({ status: 'not_configured' }),
}));

const { default: healthRouter } = await import('../../src/routes/healthRoutes.js');

function buildApp() {
  const app = express();
  app.use('/api/health', healthRouter);
  return app;
}

describe('GET /api/health/full (Centralized Health Aggregation)', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
    loggerErrorSpy.mockClear();
    loggerWarnSpy.mockClear();
    delete process.env.POLYGON_RPC_URL;
    delete process.env.KAFKA_BROKERS;
    delete process.env.KAFKA_ENABLED;
    delete process.env.ML_ENGINE_URL;
    delete globalThis.__truxify_workers;
    delete globalThis.__truxify_wsState;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ jsonrpc: '2.0', id: 1, result: '0x100' }),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns 200 with aggregated status when all critical services are healthy', async () => {
    mockSupabase = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ error: null }),
    };
    mockMongoDb = { admin: () => ({ ping: vi.fn().mockResolvedValue(true) }) };
    mockRedisClient = { ping: vi.fn().mockResolvedValue('PONG') };
    mockPgPool = {
      query: vi.fn().mockResolvedValue({ rows: [{ ok: 1 }] }),
      totalCount: 10,
      idleCount: 5,
    };
    mockFirebaseAdmin = {};
    process.env.POLYGON_RPC_URL = 'https://polygon-rpc.com';

    const res = await request(app).get('/api/health/full');

    expect(res.status).toBe(200);
    expect(['healthy', 'degraded']).toContain(res.body.status);
    expect(res.body.timestamp).toBeDefined();
    expect(res.body.uptime).toBeTypeOf('number');
    expect(res.body.responseTime).toBeGreaterThanOrEqual(0);
    expect(res.body.memory).toBeDefined();
    expect(res.body.memory.unit).toBe('MB');
    expect(res.body.version).toBeDefined();
    expect(res.body.services).toBeDefined();
    expect(res.body.summary).toBeDefined();
    expect(res.body.summary.total).toBeGreaterThan(0);
    expect(res.body.services.supabase.status).toBe('healthy');
    expect(res.body.services.mongodb.status).toBe('healthy');
    expect(res.body.services.postgres.status).toBe('healthy');
  });

  it('returns 503 when a critical service is unhealthy', async () => {
    mockSupabase = null;
    mockMongoDb = null;
    mockRedisClient = { ping: vi.fn().mockResolvedValue('PONG') };
    mockPgPool = null;

    const res = await request(app).get('/api/health/full');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('unhealthy');
    expect(res.body.services.supabase.status).toBe('unhealthy');
    expect(res.body.services.mongodb.status).toBe('unhealthy');
    expect(res.body.services.postgres.status).toBe('unhealthy');
    expect(res.body.services.redis.status).toBe('healthy');
  });

  it('returns 200 with degraded status when only non-critical services fail', async () => {
    mockSupabase = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ error: null }),
    };
    mockMongoDb = { admin: () => ({ ping: vi.fn().mockResolvedValue(true) }) };
    mockPgPool = {
      query: vi.fn().mockResolvedValue({ rows: [{ ok: 1 }] }),
      totalCount: 5,
      idleCount: 2,
    };
    mockRedisClient = { ping: vi.fn().mockRejectedValue(new Error('connection refused')) };

    const res = await request(app).get('/api/health/full');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('degraded');
    expect(res.body.services.supabase.status).toBe('healthy');
    expect(res.body.services.mongodb.status).toBe('healthy');
    expect(res.body.services.postgres.status).toBe('healthy');
    expect(res.body.services.redis.status).toBe('unhealthy');
  });

  it('includes all expected service keys', async () => {
    mockSupabase = null;
    mockMongoDb = null;
    mockRedisClient = null;
    mockPgPool = null;

    const res = await request(app).get('/api/health/full');

    const expectedServices = [
      'supabase', 'mongodb', 'postgres', 'redis',
      'firebase', 'polygon', 'escrow', 'kafka',
      'graphql', 'websocket', 'ml_engine', 'workers',
    ];
    for (const svc of expectedServices) {
      expect(res.body.services[svc]).toBeDefined();
      expect(res.body.services[svc].name).toBe(svc);
      expect(res.body.services[svc].status).toBeDefined();
      expect(res.body.services[svc].responseTime).toBeGreaterThanOrEqual(0);
      expect(res.body.services[svc].timestamp).toBeDefined();
    }
  });

  it('includes summary counts matching service statuses', async () => {
    mockSupabase = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ error: null }),
    };
    mockMongoDb = { admin: () => ({ ping: vi.fn().mockResolvedValue(true) }) };
    mockPgPool = {
      query: vi.fn().mockResolvedValue({ rows: [{ ok: 1 }] }),
      totalCount: 10,
      idleCount: 5,
    };
    mockRedisClient = { ping: vi.fn().mockResolvedValue('PONG') };

    const res = await request(app).get('/api/health/full');

    const { summary } = res.body;
    const statuses = Object.values(res.body.services).map((s) => s.status);

    expect(summary.total).toBe(statuses.length);
    expect(summary.healthy).toBe(statuses.filter((s) => s === 'healthy').length);
    expect(summary.degraded).toBe(statuses.filter((s) => s === 'degraded').length);
    expect(summary.unhealthy).toBe(statuses.filter((s) => s === 'unhealthy').length);
  });

  it('includes memory usage in MB format', async () => {
    mockSupabase = null;
    mockMongoDb = null;
    mockRedisClient = null;
    mockPgPool = null;

    const res = await request(app).get('/api/health/full');

    expect(res.body.memory.unit).toBe('MB');
    expect(res.body.memory.rss).toBeTypeOf('number');
    expect(res.body.memory.heapTotal).toBeTypeOf('number');
    expect(res.body.memory.heapUsed).toBeTypeOf('number');
    expect(res.body.memory.external).toBeTypeOf('number');
  });

  it('reports worker health when workers are registered', async () => {
    mockSupabase = null;
    mockMongoDb = null;
    mockRedisClient = null;
    mockPgPool = null;
    globalThis.__truxify_workers = {
      dlqWorker: true,
      staleOrderWorker: true,
      documentExpiryWorker: true,
    };

    const res = await request(app).get('/api/health/full');

    expect(res.body.services.workers.status).toBe('healthy');
    expect(res.body.services.workers.metadata.workerCount).toBe(3);
  });

  it('reports degraded when a worker is not running', async () => {
    mockSupabase = null;
    mockMongoDb = null;
    mockRedisClient = null;
    mockPgPool = null;
    globalThis.__truxify_workers = {
      dlqWorker: true,
      staleOrderWorker: false,
    };

    const res = await request(app).get('/api/health/full');

    expect(res.body.services.workers.status).toBe('degraded');
  });

  it('backward compatible: GET /api/health still returns the legacy format', async () => {
    mockSupabase = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ error: null }),
    };
    mockMongoDb = { admin: () => ({ ping: vi.fn().mockResolvedValue(true) }) };
    mockRedisClient = { ping: vi.fn().mockResolvedValue('PONG') };
    mockPgPool = null;
    mockFirebaseAdmin = {};
    process.env.POLYGON_RPC_URL = 'https://polygon-rpc.com';

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.services).toEqual({
      supabase: 'connected',
      mongodb: 'connected',
      redis: 'connected',
      escrow: 'not_configured',
      firebase: 'configured',
      polygon: 'configured',
    });
    expect(res.body.uptime).toBeTypeOf('number');
    expect(res.body.memory).toBeDefined();
    expect(res.body.summary).toBeUndefined();
    expect(res.body.timestamp).toBeUndefined();
  });
});
