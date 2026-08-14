import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => { req.user = req.user || { id: 'u1' }; next(); },
}));

vi.mock('../../src/middleware/redisRateLimiter.js', () => ({
  redisRateLimiter: () => (_req, _res, next) => next(),
}));

const { zkpMock } = vi.hoisted(() => ({
  zkpMock: {
    verifyDriver: vi.fn(),
    isVerified: vi.fn(),
    getVerificationStats: vi.fn(),
  },
}));

vi.mock('../../src/services/zkp/zkp.service.js', () => ({ default: zkpMock }));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import zkpRoutes from '../../src/routes/zkp.routes.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/zkp', zkpRoutes);
  return app;
}

describe('zkp.routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    zkpMock.verifyDriver.mockResolvedValue({ success: true });
  });

  describe('POST /zkp/verify', () => {
    it('returns 400 when userId is missing', async () => {
      const res = await request(makeApp()).post('/zkp/verify').send({ name: 'X' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('userId is required');
    });

    it('returns 403 when userId does not match the authenticated user', async () => {
      const res = await request(makeApp()).post('/zkp/verify').send({ userId: 'other-user' });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Forbidden');
    });

    it('returns 409 on lock conflict', async () => {
      zkpMock.verifyDriver.mockResolvedValue({ success: false, conflict: true, error: 'in progress' });
      const res = await request(makeApp()).post('/zkp/verify').send({ userId: 'u1' });
      expect(res.status).toBe(409);
    });

    it('returns 200 with the result on success', async () => {
      zkpMock.verifyDriver.mockResolvedValue({ success: true, verified: true });
      const res = await request(makeApp()).post('/zkp/verify').send({ userId: 'u1' });
      expect(res.status).toBe(200);
      expect(res.body.verified).toBe(true);
    });
  });

  describe('GET /zkp/status/:userId', () => {
    it('returns 403 for another user', async () => {
      const res = await request(makeApp()).get('/zkp/status/other-user');
      expect(res.status).toBe(403);
    });

    it('returns verification status', async () => {
      zkpMock.isVerified.mockResolvedValue(true);
      const res = await request(makeApp()).get('/zkp/status/u1');
      expect(res.status).toBe(200);
      expect(res.body.verified).toBe(true);
    });
  });

  describe('GET /zkp/stats', () => {
    it('returns stats', async () => {
      zkpMock.getVerificationStats.mockResolvedValue({ totalVerified: 1, totalUnverified: 2, total: 3 });
      const res = await request(makeApp()).get('/zkp/stats');
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(3);
    });
  });
});
