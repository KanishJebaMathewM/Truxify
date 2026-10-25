import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
const { aggregateMock } = vi.hoisted(() => ({
  aggregateMock: vi.fn(),
}));
vi.mock('../../src/core/health/index.js', () => ({
  createDefaultAggregator: () => ({
    aggregate: aggregateMock,
  }),
}));
vi.mock('../../src/middleware/rateLimiter.js', () => ({
  healthLimiter: (req, res, next) => next(),
}));
vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));
vi.mock('../../src/config/db.js', () => ({
  getAdminClient: vi.fn(),
  mongoDb: null,
  redisClient: null,
  firebaseAdmin: null,
}));
vi.mock('../../src/services/escrow.js', () => ({
  checkEscrowHealth: vi.fn(),
}));
vi.mock('../../src/middleware/sentry.js', () => ({
  captureDebugException: vi.fn(),
}));
import healthRoutes from '../../src/routes/healthRoutes.js';
function createApp() {
  const app = express();
  app.use('/api/health', healthRoutes);
  return app;
}
describe('GET /api/health/full', () => {
  beforeEach(() => {
    aggregateMock.mockReset();
  });
  it('returns 200 and expected response structure when system is healthy', async () => {
    aggregateMock.mockResolvedValue({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      responseTime: 12,
      uptime: 100,
      version: { node: 'v20.0.0', api: '1.0.0' },
      memory: {
        rss: 10,
        heapTotal: 5,
        heapUsed: 3,
        external: 1,
        unit: 'MB',
      },
      services: {
        database: {
          name: 'database',
          status: 'healthy',
          responseTime: 4,
          critical: true,
          timestamp: new Date().toISOString(),
        },
      },
      summary: {
        total: 1,
        healthy: 1,
        degraded: 0,
        unhealthy: 0,
      },
    });
    const response = await request(createApp()).get('/api/health/full');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status', 'healthy');
    expect(response.body).toHaveProperty('timestamp');
    expect(response.body).toHaveProperty('services');
    expect(response.body).toHaveProperty('summary');
    expect(response.body.services).toHaveProperty('database');
  });
  it('returns 503 when the aggregated status is unhealthy', async () => {
    aggregateMock.mockResolvedValue({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      services: {
        database: {
          name: 'database',
          status: 'unhealthy',
          responseTime: 8,
          critical: true,
          timestamp: new Date().toISOString(),
        },
      },
      summary: {
        total: 1,
        healthy: 0,
        degraded: 0,
        unhealthy: 1,
      },
    });
    const response = await request(createApp()).get('/api/health/full');
    expect(response.status).toBe(503);
    expect(response.body).toHaveProperty('status', 'unhealthy');
    expect(response.body).toHaveProperty('services');
    expect(response.body).toHaveProperty('summary');
  });
});
