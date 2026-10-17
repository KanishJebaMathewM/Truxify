/**
 * Regression tests for the /api/auth/verify account takeover.
 *
 * Before this fix the endpoint accepted an email (or nothing at all) instead of
 * a verified token, only verified when a token happened to be supplied, kept
 * the caller-supplied uid/email/role whenever verification failed, and then
 * signed a backend JWT with whatever role the looked-up profile carried.
 *
 * That made a single unauthenticated POST enough to take over any account whose
 * email was known, including admins:
 *
 *   POST /api/auth/verify {"email":"admin@truxify.com"}
 *
 * These tests drive the real route module with mocked firebase/Supabase so both
 * the escalation paths and the legitimate exchange are covered.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock the DB/config module before the route module is imported ────────────
const verifyIdToken = vi.fn();
const profileChain = () => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: null, error: null }),
  };
  return chain;
};

const state = {
  firebaseAdmin: { auth: () => ({ verifyIdToken }) },
  supabase: { from: () => profileChain() },
  uidLookup: null,
  emailLookup: null,
};

vi.mock('../../src/config/db.js', () => ({
  get firebaseAdmin() { return state.firebaseAdmin; },
  get supabase() { return state.supabase; },
  redisClient: null,
  supabaseAdmin: { from: () => profileChain() },
  createUserClient: () => profileChain(),
}));

vi.mock('../../src/config/supabase.js', () => ({ supabase: null, supabaseAdmin: { from: () => profileChain() } }));

// src/lib/profileCache.js currently has an unclosed brace and cannot be parsed
// (tracked on fix/profileCache-unclosed-brace). It is unrelated to this fix, so
// it is stubbed here to keep the route under test loadable.
vi.mock('../../src/lib/profileCache.js', () => ({
  TTL_SECONDS: 300,
  TOMBSTONE_TTL_SECONDS: 30,
  getCacheStats: () => ({ hits: 0, misses: 0 }),
  resetCacheStats: () => {},
  isValidCachedProfile: () => false,
  isValidCachedSupabaseProfile: () => false,
  getCachedProfile: async () => null,
  setCachedProfile: async () => {},
  invalidateCachedProfile: async () => {},
  getCachedSupabaseProfile: async () => null,
  setCachedSupabaseProfile: async () => {},
  invalidateCachedSupabaseProfile: async () => {},
  getCachedCustomerStats: async () => null,
  setCachedCustomerStats: async () => {},
  getCachedDriverDetails: async () => null,
  setCachedDriverDetails: async () => {},
  invalidateCachedSupabaseProfileAll: async () => {},
  invalidateProfileCache: async () => {},
  isValidProfile: () => false,
}));

const { default: router } = await import('../../src/routes/authRoutes.js');

// ── Minimal express + supertest-free harness ────────────────────────────────
const express = (await import('express')).default;

function invoke(body, { firebase = state.firebaseAdmin } = {}) {
  state.firebaseAdmin = firebase;

  const app = express();
  app.use(express.json());
  app.use(router);

  // Drive the stack directly and capture the response the router produced.
  return new Promise((resolve, reject) => {
    const req = {
      body,
      method: 'POST',
      url: '/verify',
      headers: {},
      ip: '127.0.0.1',
    };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
      send(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
      setHeader() { return this; },
      getHeader() { return undefined; },
      end() { resolve({ status: this.statusCode, body: null }); },
    };
    app.handle(req, res, (err) => (err ? reject(err) : undefined));
  });
}

/** Builds a Supabase stub whose filters resolve per-column results. */
function supabaseWithProfiles(byUid, byEmail, calls = { or: 0 }) {
  return {
    calls,
    from: () => {
      const chain = {
        _filters: {},
        select() { return chain; },
        eq(col, val) { chain._filters[col] = val; return chain; },
        // PostgREST-style OR: an .or() filter matches if any branch matches, so
        // the vulnerable implementation resolved the admin profile here.
        or(expr) {
          calls.or += 1;
          chain._orExpr = expr;
          return chain;
        },
        async maybeSingle() {
          const f = chain._filters;
          if (chain._orExpr !== undefined) {
            // Matches when either branch resolves, mirroring the old .or() call.
            return { data: byUid ?? byEmail ?? null, error: null };
          }
          if (f.firebase_uid !== undefined) return { data: byUid ?? null, error: null };
          if (f.email !== undefined) return { data: byEmail ?? null, error: null };
          return { data: null, error: null };
        },
      };
      return chain;
    },
  };
}

const ADMIN = { id: 'admin-uuid-1', role: 'admin', email: 'admin@truxify.com', firebase_uid: 'firebase-admin-uid' };

beforeEach(() => {
  verifyIdToken.mockReset();
  state.firebaseAdmin = { auth: () => ({ verifyIdToken }) };
  state.supabase = supabaseWithProfiles(null, null);
});

describe('/api/auth/verify — account takeover regression', () => {
  it('does NOT issue a token for an email-only request (no token supplied)', async () => {
    // The core exploit: no idToken at all, just a victim's email.
    state.supabase = supabaseWithProfiles(null, ADMIN);

    const res = await invoke({ email: 'admin@truxify.com' });

    expect(res.status).not.toBe(200);
    expect(res.body.token).toBeUndefined();
    expect(res.body.user).toBeUndefined();
    expect(res.status).toBe(400);
    // Verification must never have been attempted, and never succeeded silently.
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it('does NOT adopt the role of a profile matched by caller-supplied email', async () => {
    // Even if a lookup would match, an unverified request must not mint a token.
    state.supabase = supabaseWithProfiles(null, ADMIN);

    const res = await invoke({ email: 'admin@truxify.com', uid: 'firebase-admin-uid' });

    expect(res.body.token).toBeUndefined();
    expect(res.body.user?.role).not.toBe('admin');
  });

  it('does NOT honour a caller-supplied role', async () => {
    verifyIdToken.mockRejectedValue(new Error('invalid token'));

    const res = await invoke({ idToken: 'garbage', email: 'x@example.com', role: 'admin' });

    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
    expect(res.body.user?.role).not.toBe('admin');
  });

  it('rejects an invalid idToken with 401 and issues nothing', async () => {
    verifyIdToken.mockRejectedValue(new Error('Firebase ID token has expired'));

    const res = await invoke({ idToken: 'expired-token' });

    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
    expect(res.body.success).toBe(false);
  });

  it('does NOT fall back to caller-supplied identity when verification fails', async () => {
    // Old code logged the failure and kept uid/email/role from the body.
    verifyIdToken.mockRejectedValue(new Error('bad signature'));

    const res = await invoke({
      idToken: 'bad',
      uid: 'attacker-chosen-uid',
      email: 'admin@truxify.com',
      role: 'admin',
    });

    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('attacker-chosen-uid');
  });

  it('fails closed with 503 when the Firebase Admin SDK is unavailable', async () => {
    const res = await invoke({ idToken: 'anything' }, { firebase: null });

    expect(res.status).toBe(503);
    expect(res.body.token).toBeUndefined();
  });

  it('fails closed with 503 when the Supabase client is unavailable', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'u1', email: 'u1@example.com' });
    state.supabase = null;

    const res = await invoke({ idToken: 'good' });

    expect(res.status).toBe(503);
    expect(res.body.token).toBeUndefined();
  });

  it('refuses to mint a token for an unprovisioned identity', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'unknown-uid', email: 'nobody@example.com' });
    state.supabase = supabaseWithProfiles(null, null);

    const res = await invoke({ idToken: 'good' });

    expect(res.status).toBe(403);
    expect(res.body.token).toBeUndefined();
  });

  it('resolves identity from the verified token, preferring the uid match', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'firebase-admin-uid', email: 'admin@truxify.com' });
    state.supabase = supabaseWithProfiles(ADMIN, null);

    const res = await invoke({ idToken: 'good', role: 'customer' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user.id).toBe(ADMIN.id);
    // Role comes from the stored profile, not the request body.
    expect(res.body.user.role).toBe('admin');
    expect(res.body.user.uid).toBe('firebase-admin-uid');
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token.split('.')).toHaveLength(3);
  });

  it('falls back to the verified email only when the uid has no profile', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'legacy-uid', email: 'admin@truxify.com' });
    state.supabase = supabaseWithProfiles(null, ADMIN);

    const res = await invoke({ idToken: 'good' });

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(ADMIN.id);
  });

  it('never uses a body-supplied email to match a profile', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'attacker-uid' }); // no email claim
    state.supabase = supabaseWithProfiles(null, ADMIN); // ADMIN only reachable via email

    const res = await invoke({ idToken: 'good', email: 'admin@truxify.com' });

    // No verified email means the email fallback is unreachable.
    expect(res.status).toBe(403);
    expect(res.body.token).toBeUndefined();
  });

  it('defaults a blank stored role to customer rather than trusting input', async () => {
    verifyIdToken.mockResolvedValue({ uid: 'u', email: 'u@example.com' });
    state.supabase = supabaseWithProfiles({ id: 'p1', role: '   ', email: 'u@example.com' }, null);

    const res = await invoke({ idToken: 'good', role: 'admin' });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('customer');
  });

  it('never resolves identity through a PostgREST or() filter', async () => {
    const stub = supabaseWithProfiles(ADMIN, ADMIN);
    state.supabase = stub;
    verifyIdToken.mockResolvedValue({ uid: 'firebase-admin-uid', email: 'admin@truxify.com' });

    const res = await invoke({ idToken: 'good', email: 'admin@truxify.com' });

    expect(res.status).toBe(200);
    // The uid must be matched with an explicit equality filter, not a composed
    // or() that a caller could influence.
    expect(stub.calls.or).toBe(0);
  });

  it('rejects a request with no body at all', async () => {
    const res = await invoke(undefined);

    expect(res.status).toBe(400);
    expect(res.body.token).toBeUndefined();
  });
});
