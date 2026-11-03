import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => { req.user = { id: 'user-123' }; next(); },
  requireRole: (allowedRoles) => (req, res, next) => {
    if (allowedRoles.includes(req.user?.role)) {
      return next();
    }
    return res.status(403).json({ error: 'Forbidden: Insufficient privileges.' });
  },
}));

vi.mock('../../../src/middleware/redisRateLimiter.js', () => ({
  redisRateLimiter: vi.fn(() => (_req, _res, next) => next()),
}));

vi.mock('../../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../src/services/zkp/zkp.service.js', () => {
  const mockSvc = {
    verifyDriver: vi.fn(),
    isVerified: vi.fn(),
  };
  return { default: mockSvc };
});

vi.mock('../../../src/lib/redisLock.js', () => ({
  LockAcquisitionError: class LockAcquisitionError extends Error {
    constructor() { super('Lock not acquired'); }
  },
}));

const zkpService = (await import('../../../src/services/zkp/zkp.service.js')).default;
import zkpRoutes from '../../../src/routes/zkp.routes.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/zkp', zkpRoutes);
  return app;
}

describe('zkp.routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /verify', () => {
    it('returns 400 when userId is missing', async () => {
      const app = makeApp();
      const response = await request(app).post('/zkp/verify').send({});
      expect(response.status).toBe(400);
    });

    it('returns 403 when userId does not match authenticated user', async () => {
      const app = makeApp();
      const response = await request(app).post('/zkp/verify').send({ userId: 'other-user' });
      expect(response.status).toBe(403);
    });

    it('returns 200 when already verified', async () => {
      zkpService.verifyDriver.mockResolvedValue({ alreadyVerified: true, userId: 'user-123' });
      const app = makeApp();
      const response = await request(app).post('/zkp/verify').send({ userId: 'user-123' });
      expect(response.status).toBe(200);
      expect(response.body.alreadyVerified).toBe(true);
    });

    it('returns 503 when lock cannot be acquired', async () => {
      const { LockAcquisitionError } = await import('../../../src/lib/redisLock.js');
      zkpService.verifyDriver.mockRejectedValue(new LockAcquisitionError());
      const app = makeApp();
      const response = await request(app).post('/zkp/verify').send({ userId: 'user-123' });
      expect(response.status).toBe(503);
    });

    it('returns 400 when result has MOCK_PROOF_NOT_RECORDED', async () => {
      zkpService.verifyDriver.mockResolvedValue({ success: false, code: 'MOCK_PROOF_NOT_RECORDED', error: 'Mock not recorded' });
      const app = makeApp();
      const response = await request(app).post('/zkp/verify').send({ userId: 'user-123' });
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('MOCK_PROOF_NOT_RECORDED');
    });

    it('returns 400 when input is malformed', async () => {
      zkpService.verifyDriver.mockResolvedValue({ success: false, code: 'MALFORMED_INPUT', error: 'Malformed input' });
      const app = makeApp();
      const response = await request(app).post('/zkp/verify').send({ userId: 'user-123' });
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('MALFORMED_INPUT');
    });

    it('returns 400 when authority approval is missing', async () => {
      zkpService.verifyDriver.mockResolvedValue({ success: false, code: 'KYC_NOT_AUTHORITY_APPROVED', error: 'Not authority approved' });
      const app = makeApp();
      const response = await request(app).post('/zkp/verify').send({ userId: 'user-123' });
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('KYC_NOT_AUTHORITY_APPROVED');
    });

    it('returns 500 when operation fails', async () => {
      zkpService.verifyDriver.mockResolvedValue({ success: false, error: 'Internal failure' });
      const app = makeApp();
      const response = await request(app).post('/zkp/verify').send({ userId: 'user-123' });
      expect(response.status).toBe(500);
    });
  });

  describe('GET /status/:userId', () => {
    it('returns verification status', async () => {
      zkpService.isVerified.mockResolvedValue({ verified: true });
      const app = makeApp();
      const response = await request(app).get('/zkp/status/user-123');
      expect(response.status).toBe(200);
    });

    it('returns 403 when viewing another user status', async () => {
      const app = makeApp();
      const response = await request(app).get('/zkp/status/other-user');
      expect(response.status).toBe(403);
    });
  });
});
