import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../../../src/services/zkp/zkp.service.js', () => ({
  default: {
    verifyDriver: vi.fn().mockResolvedValue({ verified: true }),
  },
}));

vi.mock('../../../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock('../../../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => { req.user = { id: 'u1' }; next(); },
}));

vi.mock('../../../../src/lib/redisLock.js', () => ({
  LockAcquisitionError: class LockAcquisitionError extends Error {},
}));

vi.mock('../../../../src/middleware/redisRateLimiter.js', () => ({
  redisRateLimiter: () => (_req, _res, next) => next(),
}));

import zkpRouter from '../../../../src/routes/zkp.routes.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(zkpRouter);
  return app;
}

describe('zkp routes', () => {
  let app;

  beforeEach(() => {
    app = makeApp();
  });

  it('POST /verify returns 400 when zkp proof is missing', async () => {
    const res = await request(app)
      .post('/zkp/verify')
      .set('Authorization', 'Bearer token')
      .send({});
    expect(res.status).toBe(400);
  });
});
