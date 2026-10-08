import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import zkpRouter from '../../src/services/security/zkp.routes.js';

vi.mock('../../src/services/zkp/zkp.service.js', () => ({
  default: {
    verifyDriver: vi.fn(),
    isVerified: vi.fn(),
    getVerificationStats: vi.fn(),
  },
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../src/middleware/redisRateLimiter.js', () => ({
  redisRateLimiter: () => (req, res, next) => next(),
}));

vi.mock('../../src/lib/redisLock.js', () => ({
  LockAcquisitionError: class LockAcquisitionError extends Error {},
}));

vi.mock('../../src/lib/profileCache.js', () => ({
  default: { get: vi.fn(), set: vi.fn(), del: vi.fn() },
}));

vi.mock('mongoose', () => ({
  default: {},
  ConnectionStates: {},
}));

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/zkp', zkpRouter);
  return app;
}

describe('zkp routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('POST /verify returns 400 when zkp verification payload is missing', async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/zkp/verify')
      .set('Authorization', 'Bearer token')
      .send({});
    expect(res.status).toBe(400);
  });
});