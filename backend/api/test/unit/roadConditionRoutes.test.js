import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';

vi.mock('../../src/controllers/roadConditionController.js', () => ({
  reportGripData: vi.fn((req, res) => res.status(201).json({ success: true })),
  getNearbyGripData: vi.fn((req, res) => res.status(200).json({ success: true, data: [] })),
}));

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, res, next) => {
    req.user = { id: 'driver-123' };
    next();
  },
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  safeIpKeyGenerator: (req) => req.ip || 'default',
  createStore: () => ({ increment: vi.fn(), decrement: vi.fn() }),
}));

vi.mock('express-rate-limit', () => {
  return vi.fn(() => (req, res, next) => next());
});

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const createRouter = () => import('../../src/routes/roadConditionRoutes.js');

describe('roadConditionRoutes', () => {
  let app, router;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    const mod = await createRouter();
    router = mod.default;
    app.use('/api/road-conditions', router);
  });

  describe('POST /api/road-conditions/grip', () => {
    it('calls reportGripData controller', async () => {
      const { reportGripData } = await import('../../src/controllers/roadConditionController.js');
      const res = await import('supertest').then(m => m.default(app).post('/api/road-conditions/grip'));
      expect(res.status).toBe(201);
      expect(reportGripData).toHaveBeenCalled();
    });
  });

  describe('GET /api/road-conditions/grip/nearby', () => {
    it('calls getNearbyGripData controller', async () => {
      const { getNearbyGripData } = await import('../../src/controllers/roadConditionController.js');
      const res = await import('supertest').then(m => m.default(app).get('/api/road-conditions/grip/nearby'));
      expect(res.status).toBe(200);
      expect(getNearbyGripData).toHaveBeenCalled();
    });
  });

  describe('auth middleware', () => {
    it('returns 401 when not authenticated', async () => {
      vi.doMock('../../src/middleware/auth.js', () => ({
        authenticate: (req, res) => res.status(401).json({ error: 'Unauthorized' }),
      }));

      const mod2 = await import('../../src/routes/roadConditionRoutes.js');
      const app2 = express();
      app2.use(express.json());
      app2.use('/api/road-conditions', mod2.default);

      const res = await import('supertest').then(m => m.default(app2).post('/api/road-conditions/grip'));
      expect(res.status).toBe(401);
    });
  });
});
