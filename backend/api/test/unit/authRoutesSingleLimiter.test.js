import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// Issue #2273: /api/auth is rate limited once, where the router is mounted in
// src/index.js (`app.use('/api/auth', authLimiter, authRoutes)`). The router
// must not stack its own router-wide limiter on top of that, or every auth
// request is counted twice and capped by a hidden per-process in-memory limit.

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, res, next) => next(),
}));

vi.mock('../../src/controllers/authController.js', () => ({
  refreshToken: (req, res) => res.status(200).json({ success: true }),
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  userLimiter: (req, res, next) => next(),
  otpVerificationLimiter: (req, res, next) => next(),
  createStore: () => undefined,
}));

vi.mock('../../src/lib/profileCache.js', () => ({
  invalidateCachedProfile: vi.fn(),
  invalidateCachedSupabaseProfile: vi.fn(),
}));

vi.mock('../../src/config/db.js', () => ({
  firebaseAdmin: null,
  supabase: null,
  redisClient: null,
}));

vi.mock('../../src/services/order/orderNotificationService.js', () => ({
  OTP_MAX_FAILED_ATTEMPTS: 5,
  OTP_LOCKOUT_MINUTES: 15,
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/config/jwtSecret.js', () => ({
  getJwtSecret: () => 'test-secret',
}));

vi.mock('../../src/services/otpService.js', () => ({
  requestOtp: vi.fn(),
}));

const { default: authRouter } = await import('../../src/routes/authRoutes.js');

// express-rate-limit middleware exposes resetKey/getKey; plain handlers do not.
const isRateLimiter = (fn) =>
  typeof fn === 'function' && typeof fn.resetKey === 'function';

describe('authRoutes rate limiting (#2273)', () => {
  let mountLimiter;

  beforeEach(() => {
    // Stands in for the shared authLimiter that index.js applies at mount time.
    mountLimiter = vi.fn((req, res, next) => next());
  });

  it('does not register a router-wide rate limiter of its own', () => {
    const routerLevelLimiters = authRouter.stack.filter(
      (layer) => !layer.route && isRateLimiter(layer.handle),
    );
    expect(routerLevelLimiters).toHaveLength(0);
  });

  it('keeps the per-route limiter on POST /request-otp', () => {
    const layer = authRouter.stack.find(
      (l) => l.route && l.route.path === '/request-otp',
    );
    expect(layer).toBeDefined();
    const handlers = layer.route.stack.map((l) => l.handle);
    expect(handlers.some(isRateLimiter)).toBe(true);
  });

  it('leaves the request budget to the limiter applied at mount time', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/auth', mountLimiter, authRouter);

    // The removed router-level limiter allowed 100 requests per 15 minutes per
    // process, so request 101 used to get a 429 even when the shared limiter
    // allowed it.
    const total = 105;
    const statuses = [];
    for (let i = 0; i < total; i += 1) {
      const res = await request(app).post('/api/auth/refresh').send({});
      statuses.push(res.status);
    }

    expect(statuses.filter((s) => s === 429)).toHaveLength(0);
    expect(statuses.every((s) => s === 200)).toBe(true);
    expect(mountLimiter).toHaveBeenCalledTimes(total);
  });
});
