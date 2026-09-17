/**
 * Unit tests for backend/api/src/routes/healthRoutes.js
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  healthLimiter: (_req, _res, next) => next(),
}));

const mockSentry = vi.hoisted(() => ({
  captureDebugException: vi.fn(),
}));

vi.mock('../../src/middleware/sentry.js', () => ({
  captureDebugException: mockSentry.captureDebugException,
}));

const mockEscrow = vi.hoisted(() => ({
  checkEscrowHealth: vi.fn(),
}));

vi.mock('../../src/services/escrow.js', () => ({
  checkEscrowHealth: mockEscrow.checkEscrowHealth,
}));

const { mockAggregatorInstance } = vi.hoisted(() => ({
  mockAggregatorInstance: {
    aggregate: vi.fn(),
  },
}));

vi.mock('../../src/core/health/index.js', () => ({
  createDefaultAggregator: () => mockAggregatorInstance,
}));

const { mockDbState } = vi.hoisted(() => ({
  mockDbState: {
    supabaseAdmin: null,
    supabase: null,
    mongoDb: null,
    redisClient: null,
    firebaseAdmin: null,
  },
}));

vi.mock('../../src/config/db.js', () => ({
  get supabaseAdmin() {
    return mockDbState.supabaseAdmin;
  },
  get supabase() {
    return mockDbState.supabase;
  },
  get mongoDb() {
    return mockDbState.mongoDb;
  },
  get redisClient() {
    return mockDbState.redisClient;
  },
  get firebaseAdmin() {
    return mockDbState.firebaseAdmin;
  },
}));

import healthRoutes from '../../src/routes/healthRoutes.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/health', healthRoutes);
  return app;
}

describe('healthRoutes', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, POLYGON_RPC_URL: 'https://polygon-rpc.com' };

    mockDbState.supabaseAdmin = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ data: [{ id: '1' }], error: null }),
        }),
      }),
    };
    mockDbState.supabase = null;
    mockDbState.mongoDb = {
      admin: vi.fn().mockReturnValue({
        ping: vi.fn().mockResolvedValue({ ok: 1 }),
      }),
    };
    mockDbState.redisClient = {
      ping: vi.fn().mockResolvedValue('PONG'),
    };
    mockDbState.firebaseAdmin = {};

    mockEscrow.checkEscrowHealth.mockResolvedValue({ status: 'healthy' });
    mockAggregatorInstance.aggregate.mockResolvedValue({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        database: { status: 'healthy' },
        redis: { status: 'healthy' },
      },
    });
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('GET /health', () => {
    it('returns expected structure and 200 when all critical services are healthy', async () => {
      const app = makeApp();
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body).toEqual(
        expect.objectContaining({
          status: 'ok',
          services: {
            supabase: 'connected',
            mongodb: 'connected',
            redis: 'connected',
            escrow: 'healthy',
            firebase: 'configured',
            polygon: 'configured',
          },
          uptime: expect.any(Number),
          memory: expect.any(Object),
        })
      );
    });

    it('returns 503 and degraded status when Supabase is unreachable', async () => {
      mockDbState.supabaseAdmin = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            limit: vi.fn().mockRejectedValue(new Error('Connection error')),
          }),
        }),
      };

      const app = makeApp();
      const response = await request(app).get('/health');

      expect(response.status).toBe(503);
      expect(response.body.status).toBe('degraded');
      expect(response.body.services.supabase).toBe('failed');
    });

    it('returns 503 when MongoDB fails', async () => {
      mockDbState.mongoDb = {
        admin: vi.fn().mockReturnValue({
          ping: vi.fn().mockRejectedValue(new Error('Mongo connection refused')),
        }),
      };

      const app = makeApp();
      const response = await request(app).get('/health');

      expect(response.status).toBe(503);
      expect(response.body.status).toBe('degraded');
      expect(response.body.services.mongodb).toBe('failed');
    });

    it('returns 200 when non-critical Redis fails (soft degradation)', async () => {
      mockDbState.redisClient = {
        ping: vi.fn().mockRejectedValue(new Error('Redis timeout')),
      };

      const app = makeApp();
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
      expect(response.body.services.redis).toBe('failed');
    });

    it('returns 200 when optional MongoDB is not configured', async () => {
      mockDbState.mongoDb = null;

      const app = makeApp();
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
      expect(response.body.services.mongodb).toBe('not_configured');
    });

    it('handles not_configured states gracefully', async () => {
      mockDbState.supabaseAdmin = null;
      mockDbState.supabase = null;
      mockDbState.mongoDb = null;
      mockDbState.redisClient = null;
      mockDbState.firebaseAdmin = null;
      delete process.env.POLYGON_RPC_URL;

      const app = makeApp();
      const response = await request(app).get('/health');

      expect(response.status).toBe(503); // Supabase not configured is critical
      expect(response.body.services.supabase).toBe('not_configured');
      expect(response.body.services.mongodb).toBe('not_configured');
      expect(response.body.services.redis).toBe('not_configured');
      expect(response.body.services.firebase).toBe('not_configured');
      expect(response.body.services.polygon).toBe('not_configured');
    });
  });

  describe('GET /health/live', () => {
    it('returns 200 with status ok and uptime when server is running', async () => {
      const app = makeApp();
      const response = await request(app).get('/health/live');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: 'ok',
        uptime: expect.any(Number),
      });
    });
  });

  describe('GET /health/ready', () => {
    it('returns 200 and status ready when all critical services are connected', async () => {
      const app = makeApp();
      const response = await request(app).get('/health/ready');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: 'ready',
        services: {
          supabase: 'connected',
          mongodb: 'connected',
          redis: 'connected',
        },
      });
    });

    it('returns 503 and status not_ready when Supabase fails', async () => {
      mockDbState.supabaseAdmin = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: null, error: { message: 'Database down' } }),
          }),
        }),
      };

      const app = makeApp();
      const response = await request(app).get('/health/ready');

      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        status: 'not_ready',
        services: {
          supabase: 'failed',
          mongodb: 'connected',
          redis: 'connected',
        },
      });
    });

    it('returns 200 and status ready when optional MongoDB is not configured', async () => {
      mockDbState.mongoDb = null;

      const app = makeApp();
      const response = await request(app).get('/health/ready');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: 'ready',
        services: {
          supabase: 'connected',
          mongodb: 'not_configured',
          redis: 'connected',
        },
      });
    });
  });

  describe('GET /health/full', () => {
    it('returns 200 and detailed health breakdown from aggregator when operational', async () => {
      const mockResult = {
        status: 'healthy',
        timestamp: '2026-09-13T12:00:00.000Z',
        summary: { total: 4, healthy: 4, degraded: 0, unhealthy: 0 },
        services: {
          database: { status: 'healthy', responseTime: 12 },
          redis: { status: 'healthy', responseTime: 2 },
        },
      };
      mockAggregatorInstance.aggregate.mockResolvedValue(mockResult);

      const app = makeApp();
      const response = await request(app).get('/health/full');

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockResult);
      expect(mockAggregatorInstance.aggregate).toHaveBeenCalledTimes(1);
    });

    it('returns 503 when aggregator reports unhealthy status', async () => {
      const mockResult = {
        status: 'unhealthy',
        timestamp: '2026-09-13T12:00:00.000Z',
        summary: { total: 4, healthy: 2, degraded: 0, unhealthy: 2 },
        services: {
          database: { status: 'unhealthy', message: 'connection refused' },
        },
      };
      mockAggregatorInstance.aggregate.mockResolvedValue(mockResult);

      const app = makeApp();
      const response = await request(app).get('/health/full');

      expect(response.status).toBe(503);
      expect(response.body.status).toBe('unhealthy');
    });

    it('returns 500 when aggregator throws an unexpected exception', async () => {
      mockAggregatorInstance.aggregate.mockRejectedValue(new Error('Aggregation crash'));

      const app = makeApp();
      const response = await request(app).get('/health/full');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        status: 'unhealthy',
        timestamp: expect.any(String),
        error: 'health aggregation failed',
      });
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('GET /health/sentry-debug', () => {
    it('returns 404 when SENTRY_DEBUG_ENABLED is not true', async () => {
      delete process.env.SENTRY_DEBUG_ENABLED;
      const app = makeApp();
      const response = await request(app).get('/health/sentry-debug');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Not found' });
    });

    it('returns 200 with eventId when enabled and captureDebugException succeeds', async () => {
      process.env.SENTRY_DEBUG_ENABLED = 'true';
      process.env.NODE_ENV = 'development';
      mockSentry.captureDebugException.mockReturnValue('event-12345');

      const app = makeApp();
      const response = await request(app).get('/health/sentry-debug');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ sent: true, eventId: 'event-12345' });
    });
  });
});
