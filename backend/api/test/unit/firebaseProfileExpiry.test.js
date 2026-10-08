import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ decoded: {}, verify: vi.fn(), read: vi.fn(), write: vi.fn(), lookup: vi.fn(), logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('../../src/middleware/logger.js', () => ({ default: state.logger }));
vi.mock('../../src/config/db.js', () => {
  const query = { select() { return this; }, eq() { return this; }, maybeSingle: state.lookup };
  const client = { from: () => query };
  return { firebaseAdmin: { auth: () => ({ verifyIdToken: state.verify }) }, supabase: client, createUserClient: () => client };
});
vi.mock('../../src/lib/profileCache.js', () => ({ getCachedProfile: state.read, setCachedProfile: state.write, invalidateCachedProfile: vi.fn(), isValidCachedProfile: () => true, getCachedSupabaseProfile: vi.fn(), setCachedSupabaseProfile: vi.fn(), invalidateCachedSupabaseProfile: vi.fn(), isValidCachedSupabaseProfile: () => true, TTL_SECONDS: 120, TOMBSTONE_TTL_SECONDS: 30 }));
import { authenticate, verifyJWT, verifyAuthToken } from '../../src/middleware/auth.js';
const now = 1800000000;
const profile = { id: 'profile-id', firebase_uid: 'firebase-user', role: 'customer', full_name: 'Example', phone: '123', is_active: true };
async function call(path) {
  if (path === 'verifyAuthToken') return verifyAuthToken('firebase-access-token');
  const req = { headers: { authorization: 'Bearer firebase-access-token' }, path: '/orders', originalUrl: '/orders', ip: '127.0.0.1' };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  const next = vi.fn();
  await ({ authenticate, verifyJWT })[path](req, res, next);
  expect(next).toHaveBeenCalledOnce();
  expect(req.user.id).toBe('profile-id');
  return req.user;
}
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now * 1000);
  vi.stubEnv('BYPASS_AUTH', 'false'); vi.stubEnv('JWT_SECRET', 'local-test-secret');
  state.decoded = { uid: 'firebase-user', exp: now + 15 };
  state.verify.mockImplementation(async () => state.decoded);
  state.read.mockResolvedValue(null); state.write.mockResolvedValue(undefined);
  state.lookup.mockResolvedValue({ data: profile, error: null });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
for (const path of ['authenticate', 'verifyAuthToken', 'verifyJWT']) {
  describe(path, () => {
    it('limits active-profile cache lifetime to verified token expiry', async () => {
      const user = await call(path);
      expect(state.write).toHaveBeenCalledWith('firebase-user', user, 15);
      expect(state.verify).toHaveBeenCalledWith('firebase-access-token', true);
    });
    it('caps long-lived tokens at normal profile TTL', async () => {
      state.decoded.exp = now + 3600;
      const user = await call(path);
      expect(state.write).toHaveBeenCalledWith('firebase-user', user, 120);
    });
    it('recomputes lifetime after database lookup', async () => {
      state.lookup.mockImplementation(async () => { vi.setSystemTime((now + 10) * 1000); return { data: profile, error: null }; });
      const user = await call(path);
      expect(state.write).toHaveBeenCalledWith('firebase-user', user, 5);
    });
    it('rounds down fractional remaining lifetime instead of extending expiry', async () => {
      state.lookup.mockImplementation(async () => { vi.setSystemTime((now + 10.75) * 1000); return { data: profile, error: null }; });
      const user = await call(path);
      expect(state.write).toHaveBeenCalledWith('firebase-user', user, 4);
    });
    it('does not cache when token expires during lookup', async () => {
      state.lookup.mockImplementation(async () => { vi.setSystemTime((now + 15) * 1000); return { data: profile, error: null }; });
      await call(path);
      expect(state.write).not.toHaveBeenCalled();
    });
    it('uses normal TTL when verified expiry is absent', async () => {
      delete state.decoded.exp;
      const user = await call(path);
      expect(state.write).toHaveBeenCalledWith('firebase-user', user, 120);
    });
    it('does not reject verified active profile on cache outage', async () => {
      state.write.mockRejectedValue(new Error('cache unavailable'));
      await call(path);
      expect(state.logger.error).toHaveBeenCalled();
    });
  });
}
