/**
 * Unit tests for backend/api/src/config/db.js
 *
 * Coverage:
 *   - All clients remain null when required env vars are absent
 *   - Firebase admin disabled gracefully when FIREBASE_SERVICE_ACCOUNT_JSON is absent
 *   - Firebase admin disabled gracefully when JSON is invalid
 *   - MongoDB client creation skipped when MONGODB_URI is absent
 *   - Redis client creation skipped when REDIS_URL is absent
 *   - Supabase client creation skipped when SUPABASE_URL is absent
 *
 * Run with:  npm run test:unit -- test/unit/db.test.js
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('dotenv', () => ({
  default: {
    config: vi.fn(),
  },
}));

describe('db config — env-var guards', () => {
  const originalEnv = {};

  const ENV_VARS = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_ANON_KEY',
    'MONGODB_URI',
    'MONGODB_DB_NAME',
    'REDIS_URL',
    'FIREBASE_SERVICE_ACCOUNT_JSON',
  ];

  beforeEach(() => {
    vi.resetModules();
    // Snapshot env
    ENV_VARS.forEach((k) => {
      originalEnv[k] = process.env[k];
      delete process.env[k];
    });
  });

  afterEach(() => {
    // Restore env
    ENV_VARS.forEach((k) => {
      if (originalEnv[k] !== undefined) {
        process.env[k] = originalEnv[k];
      } else {
        delete process.env[k];
      }
    });
  });

  it('exports supabase as null when SUPABASE_URL is absent', async () => {
    vi.stubGlobal('fetch', vi.fn());

    const { supabase } = await import('../../src/config/db.js');
    expect(supabase).toBeNull();
  });

  it('exports mongoDb as null when MONGODB_URI is absent', async () => {
    vi.stubGlobal('fetch', vi.fn());

    const { mongoDb } = await import('../../src/config/db.js');
    expect(mongoDb).toBeNull();
  });

  it('exports redisClient as null when REDIS_URL is absent', async () => {
    vi.stubGlobal('fetch', vi.fn());

    const { redisClient } = await import('../../src/config/db.js');
    expect(redisClient).toBeNull();
  });

  it('exports firebaseAdmin as null when FIREBASE_SERVICE_ACCOUNT_JSON is absent', async () => {
    vi.stubGlobal('fetch', vi.fn());

    const { firebaseAdmin } = await import('../../src/config/db.js');
    expect(firebaseAdmin).toBeNull();
  });

  it('exports firebaseAdmin as null when FIREBASE_SERVICE_ACCOUNT_JSON is invalid JSON', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = 'not-valid-json';
    vi.stubGlobal('fetch', vi.fn());

    const { firebaseAdmin } = await import('../../src/config/db.js');
    expect(firebaseAdmin).toBeNull();
  });

  it('exports firebaseAdmin as null when FIREBASE_SERVICE_ACCOUNT_JSON is empty object', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '{}';
    vi.stubGlobal('fetch', vi.fn());

    const { firebaseAdmin } = await import('../../src/config/db.js');
    expect(firebaseAdmin).toBeNull();
  });
});

describe('db config — waitForMongoDb', () => {
  const originalEnv = {};
  const ENV_VARS = [
    'SUPABASE_URL',
    'MONGODB_URI',
    'REDIS_URL',
    'FIREBASE_SERVICE_ACCOUNT_JSON',
  ];

  beforeEach(() => {
    vi.resetModules();
    ENV_VARS.forEach((k) => {
      originalEnv[k] = process.env[k];
      delete process.env[k];
    });
  });

  afterEach(() => {
    ENV_VARS.forEach((k) => {
      if (originalEnv[k] !== undefined) {
        process.env[k] = originalEnv[k];
      } else {
        delete process.env[k];
      }
    });
  });

  it('resolves immediately when MONGODB_URI is not set', async () => {
    vi.stubGlobal('fetch', vi.fn());

    const { waitForMongoDb } = await import('../../src/config/db.js');
    await expect(waitForMongoDb()).resolves.toBeUndefined();
  });
});
