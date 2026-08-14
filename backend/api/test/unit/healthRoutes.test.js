import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => { req.user = { id: 'u1' }; next(); },
}));

vi.mock('../../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../src/core/health/index.js', () => ({
  createDefaultAggregator: vi.fn(() => ({
    aggregate: vi.fn().mockResolvedValue({ status: 'healthy' }),
    isHealthy: vi.fn(() => true),
  })),
}));

vi.mock('../../../src/config/db.js', () => ({
  supabase: { from: vi.fn() },
  supabaseAdmin: { from: vi.fn() },
}));

vi.mock('../../../src/config/sentry.js', () => ({
  default: {
    captureMessage: vi.fn(),
    captureException: vi.fn(),
  },
}));

import healthRoutes from '../../../src/routes/healthRoutes.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/health', healthRoutes);
  return app;
}

describe('healthRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /health', () => {
    it('returns a valid response', async () => {
      const app = makeApp();
      const response = await request(app).get('/health');
      expect([200, 503]).toContain(response.status);
      expect(response.body.status).toMatch(/^(ok|degraded)$/);
    });
  });

  describe('GET /health/ready', () => {
    it('returns a valid response', async () => {
      const app = makeApp();
      const response = await request(app).get('/health/ready');
      expect([200, 503]).toContain(response.status);
      expect(response.body.status).toMatch(/^(ok|degraded|not_ready)$/);
    });
  });

  describe('GET /health/live', () => {
    it('returns ok with uptime', async () => {
      const app = makeApp();
      const response = await request(app).get('/health/live');
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
      expect(typeof response.body.uptime).toBe('number');
    });
  });
});
