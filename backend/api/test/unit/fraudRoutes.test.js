import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => { req.user = req.user || { id: 'u1', role: 'customer' }; next(); },
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  userLimiter: (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/requirePolicy.js', () => ({
  requirePolicy: () => (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/fraudMiddleware.js', () => ({
  fraudDetectionMiddleware: (req, _res, next) => next(),
}));

vi.mock('../../src/middleware/auditLog.js', () => ({
  auditLog: () => (_req, _res, next) => next(),
}));

const { fraudMock } = vi.hoisted(() => ({
  fraudMock: {
    getFraudStats: vi.fn(),
    getOrCreateProfile: vi.fn(),
    calculateBehavioralRisk: vi.fn(),
    analyzeNetwork: vi.fn(),
    getReviewQueue: vi.fn(),
    resolveReview: vi.fn(),
    trackBehavior: vi.fn(),
  },
}));

vi.mock('../../src/services/fraud/FraudDetectionService.js', () => ({ default: fraudMock }));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import fraudRoutes from '../../src/routes/fraudRoutes.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/', fraudRoutes);
  return app;
}

describe('fraudRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fraudMock.getFraudStats.mockResolvedValue({ total: 0 });
  });

  describe('POST /fraud/track', () => {
    it('returns 400 when body userId does not match the authenticated user', async () => {
      const res = await request(makeApp())
        .post('/fraud/track')
        .send({ userId: 'someone-else', eventType: 'click' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('userId must match the authenticated user');
    });

    it('tracks behavior when userId matches', async () => {
      fraudMock.trackBehavior.mockResolvedValue({ ok: true });
      const res = await request(makeApp())
        .post('/fraud/track')
        .send({ userId: 'u1', eventType: 'click', data: { page: 'home' } });
      expect(res.status).toBe(200);
      expect(fraudMock.trackBehavior).toHaveBeenCalledWith('u1', expect.objectContaining({ type: 'click', page: 'home' }));
    });

    it('tracks behavior with empty data when none provided', async () => {
      fraudMock.trackBehavior.mockResolvedValue({ ok: true });
      const res = await request(makeApp())
        .post('/fraud/track')
        .send({ eventType: 'click' });
      expect(res.status).toBe(200);
      expect(fraudMock.trackBehavior).toHaveBeenCalledWith('u1', { type: 'click' });
    });
  });

  describe('GET /fraud/stats', () => {
    it('returns stats on success', async () => {
      const res = await request(makeApp()).get('/fraud/stats');
      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(0);
    });

    it('returns 500 on error', async () => {
      fraudMock.getFraudStats.mockRejectedValue(new Error('boom'));
      const res = await request(makeApp()).get('/fraud/stats');
      expect(res.status).toBe(500);
    });
  });
});
