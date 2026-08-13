import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => { req.user = req.user || { id: 'u1' }; next(); },
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  userLimiter: (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/requirePolicy.js', () => ({
  requirePolicy: () => (_req, _res, next) => next(),
}));

const { userClientMock, mlMock } = vi.hoisted(() => {
  const fromFn = vi.fn();
  const userClient = { from: fromFn };
  return { userClientMock: { from: fromFn, userClient }, mlMock: { predictDemand: vi.fn() } };
});

vi.mock('../../src/config/db.js', () => ({
  createUserClient: vi.fn(() => userClientMock.userClient),
}));

vi.mock('../../src/services/ml.js', () => ({
  predictDemand: mlMock,
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import demandRoutes from '../../src/routes/demandRoutes.js';

function makeApp() {
  const app = express();
  app.use('/', demandRoutes);
  return app;
}

describe('demandRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mlMock.predictDemand.mockResolvedValue({ predicted_demand: 0.5 });
  });

  describe('GET /', () => {
    it('returns a heatmap payload on success', async () => {
      const limitFn = vi.fn().mockResolvedValue({
        data: [{ pickup_address: 'A', pickup_lat: 10, pickup_lng: 20, status: 'available' }],
        error: null
      });
      const inFn = vi.fn().mockReturnValue({ limit: limitFn });
      const selectFn = vi.fn().mockReturnValue({ in: inFn });
      userClientMock.from.mockReturnValueOnce({ select: selectFn });

      const res = await request(makeApp()).get('/');
      expect(res.status).toBe(200);
      expect(res.body.type).toBe('FeatureCollection');
      expect(res.body.features).toHaveLength(1);
      expect(res.body.estimatedEarningPotential).toBeDefined();
    });

    it('returns 500 when the loads query errors', async () => {
      const limitFn = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'db down' }
      });
      const inFn = vi.fn().mockReturnValue({ limit: limitFn });
      const selectFn = vi.fn().mockReturnValue({ in: inFn });
      userClientMock.from.mockReturnValueOnce({ select: selectFn });

      const res = await request(makeApp()).get('/');
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to fetch heatmap data.');
    });
  });
});
