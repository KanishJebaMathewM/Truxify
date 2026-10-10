/**
 * Shared app-level infrastructure mock (issue #17628).
 *
 * The full-app integration suites (import '../../src/app.js') used to hit the
 * real network (test.supabase.co DNS failures) because nothing mocked the
 * config/db.js infrastructure layer. This helper builds one shared in-memory
 * Supabase + Redis + satellite mock set that suites wire with a single line:
 *
 *   import { appInfra } from '../helpers/appInfraMock.js';
 *   vi.mock('../../src/config/db.js', () => appInfra.dbModule);
 *   // THEN import app from '../../src/app.js';
 *
 * `vi.mock` factories evaluate lazily at target-import time, so the imported
 * appInfra object is already initialized.
 */
import { createSupabaseMock } from './supabaseMock.js';
import RedisMock from '../mocks/redisMock.js';

// Usage (the repo's established pattern — top-level await import, then the
// vi.mock factory reads the built object lazily at target-import time):
//   const appInfra = (await import('../helpers/appInfraMock.js')).buildAppInfra();
//   vi.mock('../../src/config/db.js', () => appInfra.dbModule);
//   import app from '../../src/app.js';
export function buildAppInfra() {
  const supabase = createSupabaseMock();
  const redis = new RedisMock();

  const mongoCollection = {
    find: () => ({
      sort: () => ({ limit: () => ({ toArray: async () => [] }) }),
      limit: () => ({ toArray: async () => [] }),
      toArray: async () => [],
    }),
    findOne: async () => null,
    insertOne: async () => ({ acknowledged: true }),
    updateOne: async () => ({ acknowledged: true }),
    deleteMany: async () => ({ acknowledged: true }),
  };

  return {
    supabase,
    redis,
    dbModule: {
      supabase: supabase.supabase,
      supabaseAdmin: supabase.supabase,
      // The accessor migration: routes read the admin client via
      // getAdminClient().
      getAdminClient: () => supabase.supabase,
      // App startup calls validateConfig() — a no-op in tests (the harness
      // pins its own env).
      validateConfig: () => true,
      createUserClient: () => supabase.supabase,
      redisClient: redis,
      upstashRedisClient: redis,
      mongoDb: { collection: () => mongoCollection },
      firebaseAdmin: null,
    },
  };
}
