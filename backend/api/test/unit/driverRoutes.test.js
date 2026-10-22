import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/config/db.js', () => ({
  supabase: {},
  supabaseAdmin: {},
  redisClient: null,
  mongoDb: null,
  firebaseAdmin: null,
}));

describe('driverRoutes', () => {
  it('can be imported', async () => {
    const mod = await import('../../src/routes/driverRoutes.js');
    expect(mod).toBeDefined();
  }, 30000);
});
