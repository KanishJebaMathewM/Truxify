import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ rows: vi.fn(), values: new Map(), redis: null, client: null }));
vi.mock('../../src/config/db.js', () => ({
  get supabaseAdmin() { return db.client; },
  get supabase() { return db.client; },
  get redisClient() { return db.redis; },
}));
vi.mock('../../src/middleware/logger.js', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { getProfile } from '../../src/services/profileService.js';
import { getCachedSupabaseProfile, setCachedSupabaseProfile } from '../../src/lib/profileCache.js';

const id = '550e8400-e29b-41d4-a716-446655440000';
const row = { id, firebase_uid: 'firebase-user', role: 'customer', full_name: 'Profile Name',
  is_active: true, email: 'profile@example.invalid', language: 'hi', dark_mode: true };

describe('full profile reads leave the authentication cache intact', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('CACHE_ENABLED', 'true');
    db.values.clear();
    db.redis = {
      get: vi.fn(async key => db.values.get(key) ?? null),
      set: vi.fn(async (key, value) => { db.values.set(key, value); }),
    };
    db.client = { from: vi.fn(() => ({ select: vi.fn(() => ({
      eq: vi.fn(() => ({ maybeSingle: db.rows })),
    })) })) };
    db.rows.mockResolvedValue({ data: row, error: null });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('returns the full database shape even when cached auth uid matches the profile id', async () => {
    await setCachedSupabaseProfile(id, { id, uid: id, role: 'customer', isActive: true, fullName: 'Auth Name' });
    expect(await getProfile(id)).toEqual(row);
    expect(db.client.from).toHaveBeenCalledWith('profiles');
  });

  it('does not replace a valid auth record with a raw snake_case database row', async () => {
    const auth = { id, uid: 'firebase-user', role: 'customer', isActive: true, fullName: 'Auth Name' };
    await setCachedSupabaseProfile(id, auth, 15);
    db.redis.set.mockClear();
    expect(await getProfile(id)).toEqual(row);
    expect(await getCachedSupabaseProfile(id)).toEqual(auth);
    expect(db.redis.set).not.toHaveBeenCalled();
  });

  it('does not treat an authentication tombstone as a full profile', async () => {
    await setCachedSupabaseProfile(id, { isActive: false }, 30);
    expect(await getProfile(id)).toEqual(row);
    expect(await getCachedSupabaseProfile(id)).toEqual({ isActive: false });
  });

  it('returns null for a missing database profile without altering an auth record', async () => {
    const auth = { id, uid: 'firebase-user', role: 'customer', isActive: true };
    await setCachedSupabaseProfile(id, auth);
    db.rows.mockResolvedValue({ data: null, error: null });
    expect(await getProfile(id)).toBeNull();
    expect(await getCachedSupabaseProfile(id)).toEqual(auth);
  });

  it('propagates database errors while preserving authentication cache contents', async () => {
    const auth = { id, uid: 'firebase-user', role: 'customer', isActive: true };
    await setCachedSupabaseProfile(id, auth);
    db.rows.mockResolvedValue({ data: null, error: new Error('database unavailable') });
    await expect(getProfile(id)).rejects.toThrow('database unavailable');
    expect(await getCachedSupabaseProfile(id)).toEqual(auth);
  });

  it('returns the same full profile when optional caches are disabled', async () => {
    vi.stubEnv('CACHE_ENABLED', 'false');
    expect(await getProfile(id)).toEqual(row);
    expect(db.redis.get).not.toHaveBeenCalled();
    expect(db.redis.set).not.toHaveBeenCalled();
  });
});
