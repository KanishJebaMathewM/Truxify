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

const { dbMock, mlMock } = vi.hoisted(() => ({
  dbMock: { supabase: { from: vi.fn() } },
  mlMock: { predictDemand: vi.fn() },
}));

vi.mock('../../src/config/db.js', () => ({
  get supabase() { return dbMock.supabase; },
}));

vi.mock('../../src/services/ml.js', () => mlMock);

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
      dbMock.supabase.from.mockReturnValue({
        select: vi.fn(() => ({ in: vi.fn(() => ({ limit: vi.fn().mockResolvedValue({ data: [{ pickup_address: 'A', pickup_lat: 10, pickup_lng: 20, status: 'available' }], error: null }) })) })),
      });
      const res = await request(makeApp()).get('/');
      expect(res.status).toBe(200);
      expect(res.body.type).toBe('FeatureCollection');
      expect(res.body.features).toHaveLength(1);
      expect(res.body.estimatedEarningPotential).toBeDefined();
    });

    it('returns 500 when the loads query errors', async () => {
      dbMock.supabase.from.mockReturnValue({
        select: vi.fn(() => ({ in: vi.fn(() => ({ limit: vi.fn().mockResolvedValue({ data: null, error: { message: 'db down' } }) })) })),
      });
      const res = await request(makeApp()).get('/');
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to fetch heatmap data.');
    });
  });
});
