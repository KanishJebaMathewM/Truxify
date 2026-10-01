import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'truxify-jwt-secret-key';

// verifyIdToken is mocked so each test controls exactly which token the route
// accepts. mockResolvedValueOnce / mockRejectedValueOnce drive the fail-closed
// and fail-open assertions below.
const verifyIdTokenMock = vi.fn();

// Mock DB module. firebaseAdmin is present so the route reaches verification.
vi.mock('../../src/config/db.js', () => {
  return {
    supabase: null,
    supabaseAdmin: null,
    firebaseAdmin: {
      auth: () => ({ verifyIdToken: verifyIdTokenMock }),
    },
    createUserClient: () => null,
    redisClient: null,
  };
});

// profileCache is mocked out: it is not under test here, and mocking keeps this
// suite independent of that module's own dependencies.
vi.mock('../../src/lib/profileCache.js', () => ({
  invalidateCachedProfile: vi.fn().mockResolvedValue(undefined),
  invalidateCachedSupabaseProfile: vi.fn().mockResolvedValue(undefined),
  invalidateCachedSupabaseProfileAll: vi.fn().mockResolvedValue(undefined),
  invalidateProfileCache: vi.fn().mockResolvedValue(undefined),
  getCachedProfile: vi.fn().mockResolvedValue(null),
  setCachedProfile: vi.fn().mockResolvedValue(undefined),
  isValidCachedProfile: vi.fn().mockReturnValue(false),
  isValidProfile: vi.fn().mockReturnValue(false),
  TTL_SECONDS: 120,
  TOMBSTONE_TTL_SECONDS: 30,
}));

import authRoutes from '../../src/routes/authRoutes.js';

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);

/** Decodes the returned backend JWT so the signed claims can be asserted. */
function decodeToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

describe('POST /api/auth/verify — Firebase ID Token to Backend JWT exchange', () => {
  beforeEach(() => {
    verifyIdTokenMock.mockReset();
  });

  describe('rejects requests without a verifiable idToken', () => {
    // The endpoint exists to exchange a *verified* Firebase token. An empty
    // body must not produce a token.
    it('returns 401 for an empty body', async () => {
      const res = await request(app).post('/api/auth/verify').send({});

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.token).toBeUndefined();
      expect(verifyIdTokenMock).not.toHaveBeenCalled();
    });

    // The regression this change fixes: an email was enough to get a signed JWT,
    // so the caller-supplied role below was signed into it verbatim.
    it('returns 401 for an email-only request that also asks for admin', async () => {
      const res = await request(app)
        .post('/api/auth/verify')
        .send({ email: 'attacker@truxify.com', role: 'admin' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.token).toBeUndefined();
    });

    it('returns 401 when verifyIdToken rejects the token', async () => {
      verifyIdTokenMock.mockRejectedValueOnce(new Error('Firebase ID token has expired.'));

      const res = await request(app)
        .post('/api/auth/verify')
        .send({ idToken: 'an-expired-token', role: 'admin' });

      // Previously this was only logged, then execution continued and signed a
      // backend JWT built from the unverified request body.
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.token).toBeUndefined();
    });

    it('returns 401 when a token verifies but carries no uid', async () => {
      verifyIdTokenMock.mockResolvedValueOnce({ email: 'nobody@truxify.com' });

      const res = await request(app)
        .post('/api/auth/verify')
        .send({ idToken: 'uidless-token', role: 'admin' });

      expect(res.status).toBe(401);
      expect(res.body.token).toBeUndefined();
    });
  });

  describe('derives identity only from the verified token', () => {
    it('issues a backend JWT for a valid idToken', async () => {
      verifyIdTokenMock.mockResolvedValueOnce({
        uid: 'firebase-uid-999',
        email: 'driver.auth@truxify.com',
      });

      const res = await request(app)
        .post('/api/auth/verify')
        .send({ idToken: 'a-valid-token' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.email).toBe('driver.auth@truxify.com');

      const decoded = decodeToken(res.body.token);
      expect(decoded.uid).toBe('firebase-uid-999');
      expect(decoded.email).toBe('driver.auth@truxify.com');
      expect(decoded.iss).toBe('truxify-backend-api');
    });

    // The core privilege-escalation regression: `role` from the body used to be
    // signed straight into the JWT whenever the Supabase profile lookup missed,
    // which is the common case.
    it('ignores a caller-supplied role and signs the lowest-privilege default', async () => {
      verifyIdTokenMock.mockResolvedValueOnce({
        uid: 'firebase-uid-999',
        email: 'driver.auth@truxify.com',
      });

      const res = await request(app)
        .post('/api/auth/verify')
        .send({ idToken: 'a-valid-token', role: 'admin' });

      expect(res.status).toBe(200);
      expect(res.body.user.role).toBe('customer');
      expect(decodeToken(res.body.token).role).toBe('customer');
    });

    it('ignores a caller-supplied uid', async () => {
      verifyIdTokenMock.mockResolvedValueOnce({ uid: 'real-uid', email: 'a@b.c' });

      const res = await request(app)
        .post('/api/auth/verify')
        .send({ idToken: 'a-valid-token', uid: 'attacker-chosen-uid' });

      expect(decodeToken(res.body.token).uid).toBe('real-uid');
    });

    it('accepts the token under the `token` field name too', async () => {
      verifyIdTokenMock.mockResolvedValueOnce({ uid: 'firebase-uid-999' });

      const res = await request(app)
        .post('/api/auth/verify')
        .send({ token: 'a-valid-token' });

      expect(res.status).toBe(200);
      expect(verifyIdTokenMock).toHaveBeenCalledWith('a-valid-token');
    });

    it('tolerates a token with no email claim', async () => {
      verifyIdTokenMock.mockResolvedValueOnce({ uid: 'firebase-uid-999' });

      const res = await request(app)
        .post('/api/auth/verify')
        .send({ idToken: 'a-valid-token' });

      expect(res.status).toBe(200);
      expect(res.body.user.email).toBeNull();
    });

    // End-to-end shape of the vulnerability: an admin JWT from this exchange is
    // exactly what every requireRole(['admin']) check downstream trusts.
    it('cannot obtain an admin JWT through the exchange endpoint', async () => {
      verifyIdTokenMock.mockResolvedValueOnce({
        uid: 'firebase-uid-999',
        email: 'attacker@truxify.com',
      });

      const res = await request(app)
        .post('/api/auth/verify')
        .send({ idToken: 'a-valid-token', role: 'admin', uid: 'attacker-uid' });

      expect(res.status).toBe(200);

      const decoded = decodeToken(res.body.token);
      expect(decoded.role).not.toBe('admin');
      expect(decoded.uid).toBe('firebase-uid-999');
    });
  });
});
