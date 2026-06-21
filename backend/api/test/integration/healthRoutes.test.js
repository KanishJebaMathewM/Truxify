import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// Define mocks that we can mutate per-test
let mockSupabase = null;
let mockMongoDb = null;
let mockRedisClient = null;
let mockFirebaseAdmin = null;

vi.mock('../../src/config/db.js', () => ({
  get supabase() { return mockSupabase; },
  get mongoDb() { return mockMongoDb; },
  get redisClient() { return mockRedisClient; },
  get firebaseAdmin() { return mockFirebaseAdmin; }
}));

const loggerErrorSpy = vi.fn();
vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    error: (...args) => loggerErrorSpy(...args),
    info: vi.fn(),
    warn: vi.fn(),
  }
}));

const { default: healthRouter } = await import('../../src/routes/healthRoutes.js');

function buildApp() {
  const app = express();
  app.use('/api/health', healthRouter);
  return app;
}

describe('GET /api/health', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
    loggerErrorSpy.mockClear();

    // Reset default healthy mocks
    mockSupabase = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ error: null })
    };

    mockMongoDb = {
      admin: () => ({
        ping: vi.fn().mockResolvedValue(true)
      })
    };

    mockRedisClient = {
      ping: vi.fn().mockResolvedValue('PONG')
    };

    mockFirebaseAdmin = {};
    process.env.POLYGON_RPC_URL = 'http://localhost:8545';
  });

  it('returns 200 and "ok" status when all services are healthy', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.services).toEqual({
      supabase: 'connected',
      mongodb: 'connected',
      redis: 'connected',
      firebase: 'configured',
      polygon: 'configured'
    });
    expect(loggerErrorSpy).not.toHaveBeenCalled();
  });

  it('returns 503 and degraded status when Supabase connection check fails with an exception', async () => {
    mockSupabase.limit.mockRejectedValueOnce(new Error('Supabase network error'));

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.services.supabase).toBe('failed');
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      '[health] Supabase check failed:',
      'Supabase network error'
    );
  });

  it('returns 503 and degraded status when MongoDB ping fails with an exception', async () => {
    mockMongoDb = {
      admin: () => ({
        ping: vi.fn().mockRejectedValueOnce(new Error('MongoDB timeout'))
      })
    };

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.services.mongodb).toBe('failed');
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      '[health] MongoDB check failed:',
      'MongoDB timeout'
    );
  });

  it('returns 200 when Redis fails (since Redis is non-critical), but logs the failure', async () => {
    mockRedisClient.ping.mockRejectedValueOnce(new Error('Redis connection refused'));

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.services.redis).toBe('failed');
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      '[health] Redis check failed:',
      'Redis connection refused'
    );
  });

  it('handles "not_configured" state correctly for Supabase, MongoDB, and Redis', async () => {
    mockSupabase = null;
    mockMongoDb = null;
    mockRedisClient = null;
    mockFirebaseAdmin = null;
    delete process.env.POLYGON_RPC_URL;

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(503); // Degraded because Supabase and MongoDB are not configured
    expect(res.body.status).toBe('degraded');
    expect(res.body.services).toEqual({
      supabase: 'not_configured',
      mongodb: 'not_configured',
      redis: 'not_configured',
      firebase: 'not_configured',
      polygon: 'not_configured'
    });
    expect(loggerErrorSpy).not.toHaveBeenCalled();
  });
});

describe('GET /api/health/live', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
  });

  it('returns 200 and ok status', async () => {
    const res = await request(app).get('/api/health/live');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.uptime).toBeTypeOf('number');
  });
});
