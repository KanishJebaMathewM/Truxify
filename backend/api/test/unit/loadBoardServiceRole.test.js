/**
 * Regression tests for the /api/loads board read path (issue #7328).
 *
 * The load_offers reads previously ran through the shared anon-key supabase
 * client. load_offers is RLS-enabled with all anon privileges revoked, so the
 * board always returned [] / total 0 and single-load fetches 404'd. These
 * tests prove the reads run through the service-role client and that the anon
 * client is never consulted.
 *
 * Run with:  npm test -- test/unit/loadBoardServiceRole.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const { createSupabaseMock } = await vi.importActual('../helpers/supabaseMock.js');
const m = createSupabaseMock();

const { anonFrom } = vi.hoisted(() => ({
  anonFrom: vi.fn(() => {
    throw new Error('anon supabase must never be used by the loads board');
  }),
}));

vi.mock('../../src/config/db.js', () => ({
  supabase: { from: anonFrom, rpc: vi.fn() },
  supabaseAdmin: m.supabase,
  firebaseAdmin: null,
  redisClient: null,
  mongoDb: null,
}));

const { default: loadRouter } = await import('../../src/routes/loadRoutes.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/loads', loadRouter);
  return app;
}

describe('GET /api/loads — service-role client', () => {
  beforeEach(() => {
    process.env.BYPASS_AUTH = 'true';
    process.env.NODE_ENV = 'test';
    m.store.load_offers = [
      { id: 'load-1', status: 'available', pickup_address: 'Mumbai', drop_address: 'Delhi', freight_value: 115000 },
    ];
    m.calls.length = 0;
    vi.clearAllMocks();
  });

  it('returns available offers from the database', async () => {
    const res = await request(buildApp())
      .get('/api/loads')
      .set('x-user-id', 'driver-uuid-123')
      .set('x-user-role', 'driver');

    expect(res.status).toBe(200);
    expect(anonFrom).not.toHaveBeenCalled();
    expect(res.body.loads.length).toBe(1);
    expect(res.body.total).toBe(1);
    const boardCall = m.calls.find(c => c.table === 'load_offers' && c.mode === 'select');
    expect(boardCall.filters).toEqual([{ col: 'status', op: 'eq', val: 'available' }]);
  });

  it('returns 404 for an unavailable load via the service-role client', async () => {
    m.store.load_offers = [{ id: 'load-claimed', status: 'claimed' }];

    const res = await request(buildApp())
      .get('/api/loads/load-claimed')
      .set('x-user-id', 'driver-uuid-123')
      .set('x-user-role', 'driver');

    expect(res.status).toBe(404);
    expect(anonFrom).not.toHaveBeenCalled();
  });
});
