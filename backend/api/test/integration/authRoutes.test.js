/**
 * Integration tests for POST /api/auth/logout
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const invalidateCachedProfileMock = vi.fn().mockResolvedValue(undefined);
const revokeRefreshTokensMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/lib/profileCache.js', () => ({
  invalidateCachedProfile: invalidateCachedProfileMock,
  getCachedProfile: vi.fn().mockResolvedValue(null),
  setCachedProfile: vi.fn().mockResolvedValue(undefined),
  isValidCachedProfile: vi.fn().mockReturnValue(true),
  TTL_SECONDS: 900,
  TOMBSTONE_TTL_SECONDS: 30,
}));

vi.mock('../../src/config/db.js', () => ({
  supabase: null,
  firebaseAdmin: {
    auth: () => ({ revokeRefreshTokens: revokeRefreshTokensMock }),
  },
  redisClient: null,
  mongoDb: null,
}));

// Mock authenticate middleware to control auth contract deterministically
vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, res, next) => {
    const userId = req.headers['x-user-id'];
    if (!userId) {
      return res.status(401).json({ error: 'Access Denied. No token provided.' });
    }
    req.user = {
      id:       userId,
      uid:      `firebase_uid_${userId}`,
      role:     req.headers['x-user-role'] || 'customer',
      fullName: 'Test User',
      isActive: true,
    };
    next();
  },
  requireRole: () => (_req, _res, next) => next(),
}));

const { default: authRouter } = await import('../../src/routes/authRoutes.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  return app;
}

const CUSTOMER_ID = '11111111-1111-1111-1111-111111111111';
const DRIVER_ID   = '22222222-2222-2222-2222-222222222222';

describe('POST /api/auth/logout', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
  });

  it('returns 200 { success: true } for authenticated user', async () => {
    const res = await request(app)
      .post('/api/auth/logout')
      .set('x-user-id', CUSTOMER_ID)
      .set('x-user-role', 'customer');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Logged out successfully');
  });

  it('returns 401 for unauthenticated request', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(401);
  });

  it('invalidates Redis cache with the exact uid of the authenticated user', async () => {
    await request(app)
      .post('/api/auth/logout')
      .set('x-user-id', CUSTOMER_ID)
      .set('x-user-role', 'customer');

    expect(invalidateCachedProfileMock).toHaveBeenCalledOnce();
    expect(invalidateCachedProfileMock).toHaveBeenCalledWith(`firebase_uid_${CUSTOMER_ID}`);
  });

  it('invalidates only the current user cache — not other users', async () => {
    await request(app)
      .post('/api/auth/logout')
      .set('x-user-id', DRIVER_ID)
      .set('x-user-role', 'driver');

    expect(invalidateCachedProfileMock).toHaveBeenCalledOnce();
    expect(invalidateCachedProfileMock).toHaveBeenCalledWith(`firebase_uid_${DRIVER_ID}`);
    expect(invalidateCachedProfileMock).not.toHaveBeenCalledWith(`firebase_uid_${CUSTOMER_ID}`);
  });

  it('attempts Firebase revocation with correct uid', async () => {
    await request(app)
      .post('/api/auth/logout')
      .set('x-user-id', CUSTOMER_ID)
      .set('x-user-role', 'customer');

    expect(revokeRefreshTokensMock).toHaveBeenCalledOnce();
    expect(revokeRefreshTokensMock).toHaveBeenCalledWith(`firebase_uid_${CUSTOMER_ID}`);
  });

  it('returns 200 even when Redis invalidation fails', async () => {
    invalidateCachedProfileMock.mockRejectedValueOnce(new Error('Redis unavailable'));

    const res = await request(app)
      .post('/api/auth/logout')
      .set('x-user-id', CUSTOMER_ID)
      .set('x-user-role', 'customer');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 200 even when Firebase revocation fails', async () => {
    revokeRefreshTokensMock.mockRejectedValueOnce(new Error('Firebase unavailable'));

    const res = await request(app)
      .post('/api/auth/logout')
      .set('x-user-id', CUSTOMER_ID)
      .set('x-user-role', 'customer');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
