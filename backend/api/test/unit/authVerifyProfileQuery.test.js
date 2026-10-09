import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import jwt from 'jsonwebtoken';

const state = vi.hoisted(() => {
  const oldSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'configured-profile-query-regression-test-secret';
  return { oldSecret, verifyToken: vi.fn(), from: vi.fn(), log: vi.fn() };
});
vi.mock('../../src/middleware/auth.js', () => ({ authenticate: (_req, _res, next) => next() }));
vi.mock('../../src/controllers/authController.js', () => ({ refreshToken: vi.fn() }));
vi.mock('../../src/middleware/rateLimiter.js', () => ({ userLimiter: vi.fn(), otpVerificationLimiter: vi.fn() }));
vi.mock('../../src/lib/profileCache.js', () => ({ invalidateCachedProfile: vi.fn(), invalidateCachedSupabaseProfile: vi.fn() }));
vi.mock('../../src/services/order/orderNotificationService.js', () => ({ OTP_MAX_FAILED_ATTEMPTS: 5, OTP_LOCKOUT_MINUTES: 15 }));
vi.mock('../../src/services/otpService.js', () => ({ requestOtp: vi.fn() }));
vi.mock('../../src/middleware/logger.js', () => ({ default: { error: state.log, warn: vi.fn(), info: vi.fn() } }));
vi.mock('../../src/config/db.js', () => ({
  supabase: { from: state.from }, redisClient: null,
  firebaseAdmin: { auth: () => ({ verifyIdToken: state.verifyToken }) },
}));

const { default: router } = await import('../../src/routes/authRoutes.js');
const handler = router.stack.find((layer) => layer.route?.path === '/verify').route.stack.at(-1).handle;
const oldEnvironment = process.env.NODE_ENV;
let query;
let profile;
let databaseError;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NODE_ENV = 'production';
  profile = { id: 'profile-123', role: 'driver', is_active: true };
  databaseError = null;
  state.verifyToken.mockResolvedValue({ uid: 'firebase-123', email: 'driver@example.test' });
  query = {
    selected: [], select: vi.fn(function (columns) { this.selected = columns.split(',').map((s) => s.trim()); return this; }),
    eq: vi.fn(function () { return this; }), or: vi.fn(function () { return this; }),
    maybeSingle: vi.fn(async () => ({
      data: profile && Object.fromEntries(query.selected.filter((key) => key in profile).map((key) => [key, profile[key]])),
      error: databaseError,
    })),
  };
  state.from.mockReturnValue(query);
});

afterAll(() => {
  process.env.NODE_ENV = oldEnvironment;
  if (state.oldSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = state.oldSecret;
});

async function verify(body = { idToken: 'verified-test-token' }) {
  const res = { code: 200, body: null, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ body }, res);
  return res;
}

describe('Firebase token exchange with a configured profile database', () => {
  it('signs the trusted profile identity and role after successful lookup', async () => {
    const res = await verify({ idToken: 'verified-test-token', role: 'admin', userId: 'attacker' });
    expect(res.code).toBe(200);
    const claims = jwt.verify(res.body.token, process.env.JWT_SECRET);
    expect(claims).toMatchObject({ id: 'profile-123', uid: 'firebase-123', role: 'driver', iss: 'truxify-backend-api' });
    expect(query.or).toHaveBeenCalledWith('firebase_uid.eq.firebase-123,email.eq.driver@example.test');
  });

  it('selects the activity field and rejects deactivated profiles without a token', async () => {
    profile.is_active = false;
    const res = await verify();
    expect(query.selected).toContain('is_active');
    expect(res.code).toBe(403);
    expect(res.body.token).toBeUndefined();
  });

  it('returns the intended sanitized error for a failed profile query', async () => {
    databaseError = { message: 'private database detail' };
    profile = null;
    const res = await verify();
    expect(res.code).toBe(500);
    expect(res.body.error).toBe('Database error during authentication.');
    expect(JSON.stringify(res.body)).not.toContain('private database detail');
    expect(res.body.token).toBeUndefined();
  });

  it('fails closed on a query error even if data accompanies the error', async () => {
    databaseError = { message: 'query incomplete' };
    const res = await verify();
    expect(res.code).toBe(500);
    expect(res.body.token).toBeUndefined();
  });

  it('rejects a missing profile outside test mode', async () => {
    profile = null;
    const res = await verify();
    expect(res.code).toBe(401);
    expect(res.body.code).toBe('PROFILE_NOT_FOUND');
    expect(res.body.token).toBeUndefined();
  });

  it('uses only the verified UID when the identity has no email', async () => {
    state.verifyToken.mockResolvedValue({ uid: 'firebase-123' });
    const res = await verify({ idToken: 'verified-test-token', email: 'attacker@example.test' });
    expect(res.code).toBe(200);
    expect(query.eq).toHaveBeenCalledWith('firebase_uid', 'firebase-123');
    expect(query.or).not.toHaveBeenCalled();
  });

  it('does not query profiles when Firebase rejects the token', async () => {
    state.verifyToken.mockRejectedValue(new Error('invalid token'));
    const res = await verify();
    expect(res.code).toBe(401);
    expect(state.from).not.toHaveBeenCalled();
  });
});
