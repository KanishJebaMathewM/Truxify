import { beforeEach, describe, expect, it, vi } from 'vitest';

const { client, query, noop } = vi.hoisted(() => {
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(), insert: vi.fn() };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return { query, client: { from: vi.fn(() => query) }, noop: (_req, _res, next) => next() };
});
vi.mock('../../src/config/db.js', () => ({ supabase: client, supabaseAdmin: client }));
vi.mock('../../src/middleware/auth.js', () => ({ authenticate: noop }));
vi.mock('../../src/middleware/rateLimiter.js', () => ({ userLimiter: noop }));
vi.mock('../../src/middleware/validate.js', () => ({ validateParams: () => noop }));
vi.mock('../../src/middleware/logger.js', () => ({ default: { error: vi.fn() } }));
import tripRoutes from '../../src/routes/tripRoutes.js';

const handler = tripRoutes.stack.find(layer => layer.route?.path === '/:id/start').route.stack.at(-1).handle;

describe('existing trip start status', () => {
  let trip;
  beforeEach(() => {
    vi.clearAllMocks();
    trip = { id: 'trip', trip_display_id: 'TX-order', driver_id: 'owner', status: 'active' };
    query.maybeSingle.mockImplementation(async () => ({ data: trip, error: null }));
  });

  async function request(user = { id: 'owner', role: 'driver' }) {
    const res = { status: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);
    await handler({ params: { id: trip.trip_display_id }, user }, res);
    return res;
  }

  for (const status of ['completed', 'cancelled', 'pending', null, undefined]) {
    it(`rejects existing ${status} trip without changing it`, async () => {
      trip.status = status;
      const res = await request();
      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({ error: `Trip cannot be started: status is ${status}.` });
      expect(query.insert).not.toHaveBeenCalled();
      expect(client.from).toHaveBeenCalledTimes(1);
      expect(trip.status).toBe(status);
    });
  }

  it('returns an owned active trip as the idempotent result', async () => {
    const res = await request();
    expect(res.json).toHaveBeenCalledWith(trip);
    expect(res.status).not.toHaveBeenCalled();
    expect(query.insert).not.toHaveBeenCalled();
  });

  it('preserves ownership checks before exposing terminal status', async () => {
    trip.status = 'completed';
    const res = await request({ id: 'other', role: 'driver' });
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Access Denied: Trip does not belong to you.' });
  });

  it('an administrator also cannot start a completed trip', async () => {
    trip.status = 'completed';
    const res = await request({ id: 'admin', role: 'admin' });
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('an administrator may retrieve an existing active trip', async () => {
    const res = await request({ id: 'admin', role: 'admin' });
    expect(res.json).toHaveBeenCalledWith(trip);
    expect(res.status).not.toHaveBeenCalled();
  });
});
