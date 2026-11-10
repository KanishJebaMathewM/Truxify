import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

const { mockAnonFrom } = vi.hoisted(() => ({
  mockAnonFrom: vi.fn(),
}));

vi.mock('../../src/config/db.js', () => ({
  supabase: { from: mockAnonFrom },
  supabaseAdmin: null,
  firebaseAdmin: null,
  redisClient: null,
}));

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  userLimiter: (_req, _res, next) => next(),
  otpVerificationLimiter: (_req, _res, next) => next(),
  createStore: () => undefined,
}));

vi.mock('../../src/controllers/authController.js', () => ({
  refreshToken: (_req, _res, next) => next(),
}));

vi.mock('../../src/services/order/orderNotificationService.js', () => ({
  OTP_MAX_FAILED_ATTEMPTS: 5,
  OTP_LOCKOUT_MINUTES: 30,
}));

const { default: authRouter } = await import('../../src/routes/authRoutes.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  return app;
}

describe('POST /api/auth/verify-otp without a service-role client', () => {
  it('fails closed with 503 instead of querying phone_otps through anon', async () => {
    const res = await request(buildApp())
      .post('/api/auth/verify-otp')
      .send({ phone: '1234567890', otp: '123456' });

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/temporarily unavailable/i);
    expect(mockAnonFrom).not.toHaveBeenCalled();
  });
});
