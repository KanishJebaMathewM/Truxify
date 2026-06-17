/**
 * Integration tests for PUT /api/profile/fcm-token
 *
 * Verifies:
 *   - Authenticated users can register an FCM token
 *   - Authenticated users can clear an FCM token (null)
 *   - Invalid fcmToken type returns 400
 *   - Unauthenticated requests return 401
 *   - Redis cache is invalidated on token update
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const invalidateCachedProfileMock = vi.fn().mockResolvedValue(undefined);
const supabaseUpdateMock = vi.fn();

vi.mock('../../src/lib/profileCache.js', () => ({
  invalidateCachedProfile: invalidateCachedProfileMock,
  getCachedProfile: vi.fn().mockResolvedValue(null),
  setCachedProfile: vi.fn().mockResolvedValue(undefined),
  isValidCachedProfile: vi.fn().mockReturnValue(true),
  TTL_SECONDS: 900,
  TOMBSTONE_TTL_SECONDS: 30,
}));

vi.mock('../../src/config/db.js', () => ({
  supabase: {
    from: () => ({
      update: (data) => {
        supabaseUpdateMock(data);
        return {
          eq: () => ({ error: null }),
        };
      },
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
    }),
  },
  firebaseAdmin: null,
  redisClient: null,
  mongoDb: null,
}));

const { default: profileRouter } = await import('../../src/routes/profileRoutes.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.headers['x-user-id'];
    if (userId) {
      req.user = {
        id: userId,
        uid: 'test_firebase_uid_123',
        role: req.headers['x-user-role'] || 'customer',
        fullName: 'Test User',
        isActive: true,
      };
    }
    next();
  });
  app.use('/api/profile', profileRouter);
  return app;
}

const USER_ID = '11111111-1111-1111-1111-111111111111';
const FCM_TOKEN = 'fcm_token_abc123xyz';

describe('PUT /api/profile/fcm-token', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
  });

  it('returns 200 and updates FCM token for authenticated user', async () => {
    const res = await request(app)
      .put('/api/profile/fcm-token')
      .set('x-user-id', USER_ID)
      .set('x-user-role', 'customer')
      .send({ fcmToken: FCM_TOKEN });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('FCM token updated successfully.');
  });

  it('returns 401 for unauthenticated request', async () => {
    const res = await request(app)
      .put('/api/profile/fcm-token')
      .send({ fcmToken: FCM_TOKEN });

    expect(res.status).toBe(401);
  });

  it('accepts null to clear FCM token', async () => {
    const res = await request(app)
      .put('/api/profile/fcm-token')
      .set('x-user-id', USER_ID)
      .set('x-user-role', 'customer')
      .send({ fcmToken: null });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 400 for non-string non-null fcmToken', async () => {
    const res = await request(app)
      .put('/api/profile/fcm-token')
      .set('x-user-id', USER_ID)
      .set('x-user-role', 'customer')
      .send({ fcmToken: 12345 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/string/i);
  });

  it('invalidates Redis cache after token update', async () => {
    await request(app)
      .put('/api/profile/fcm-token')
      .set('x-user-id', USER_ID)
      .set('x-user-role', 'customer')
      .send({ fcmToken: FCM_TOKEN });

    expect(invalidateCachedProfileMock).toHaveBeenCalledOnce();
    expect(invalidateCachedProfileMock).toHaveBeenCalledWith('test_firebase_uid_123');
  });

  it('updates fcm_token_updated_at timestamp on token registration', async () => {
    await request(app)
      .put('/api/profile/fcm-token')
      .set('x-user-id', USER_ID)
      .set('x-user-role', 'customer')
      .send({ fcmToken: FCM_TOKEN });

    expect(supabaseUpdateMock).toHaveBeenCalledOnce();
    const updatePayload = supabaseUpdateMock.mock.calls[0][0];
    expect(updatePayload).toHaveProperty('fcm_token', FCM_TOKEN);
    expect(updatePayload).toHaveProperty('fcm_token_updated_at');
    expect(typeof updatePayload.fcm_token_updated_at).toBe('string');
  });

  it('returns 400 if fcmToken is omitted', async () => {
    const res = await request(app)
      .put('/api/profile/fcm-token')
      .set('x-user-id', USER_ID)
      .set('x-user-role', 'customer')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });
});
