import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const zkpMocks = vi.hoisted(() => ({
  verifyDriver: vi.fn(),
  isVerified: vi.fn(),
  getVerificationStats: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({ default: mockLogger }));

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

vi.mock('../../src/services/zkp/zkp.service.js', () => ({
  default: zkpMocks,
}));

const zkpRouter = (await import('../../src/services/security/zkp.routes.js')).default;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/zkp', zkpRouter);
  return app;
}

describe('zkp routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    zkpMocks.verifyDriver.mockResolvedValue({ success: true });
    zkpMocks.isVerified.mockResolvedValue(true);
    zkpMocks.getVerificationStats.mockResolvedValue({ total: 1 });
  });

  it('exports an express router as the default export', () => {
    expect(typeof zkpRouter).toBe('function');
  });

  it('POST /verify returns 400 when userId is missing', async () => {
    const res = await request(makeApp()).post('/zkp/verify').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('userId is required');
    expect(zkpMocks.verifyDriver).not.toHaveBeenCalled();
  });

  it('POST /verify delegates to verifyDriver and returns 200 on success', async () => {
    const res = await request(makeApp())
      .post('/zkp/verify')
      .send({ userId: 'u1', name: 'A' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(zkpMocks.verifyDriver).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', name: 'A' }),
    );
  });

  it('POST /verify returns 409 when the lock is already held', async () => {
    zkpMocks.verifyDriver.mockResolvedValue({ conflict: true, error: 'in-flight' });
    const res = await request(makeApp()).post('/zkp/verify').send({ userId: 'u1' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('in-flight');
  });

  it('POST /verify returns 503 when the distributed lock cannot be acquired', async () => {
    const { LockAcquisitionError } = await import('../../src/lib/redisLock.js');
    zkpMocks.verifyDriver.mockRejectedValue(new LockAcquisitionError('redis down'));
    const res = await request(makeApp()).post('/zkp/verify').send({ userId: 'u1' });
    expect(res.status).toBe(503);
  });

  it('GET /status/:userId returns the verification status', async () => {
    const res = await request(makeApp()).get('/zkp/status/u1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, verified: true });
  });

  it('GET /stats returns aggregate verification counts', async () => {
    const res = await request(makeApp()).get('/zkp/stats');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, total: 1 });
  });
});