/**
 * Regression tests for the /api/trucks/search driver-search read path
 * (issue #7327).
 *
 * The driver_details / trucks / profiles reads previously ran through the
 * shared anon-key supabase client. Those tables are RLS-enabled with all anon
 * privileges revoked, so the search always errored or returned empty. These
 * tests prove the search runs through the service-role client and that the
 * anon client is never consulted.
 *
 * Run with:  npm test -- test/unit/truckSearchServiceRole.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const { createSupabaseMock } = await vi.importActual('../helpers/supabaseMock.js');
const m = createSupabaseMock();

let mockTelemetryResults = [];

const { anonFrom } = vi.hoisted(() => ({
  anonFrom: vi.fn(() => {
    throw new Error('anon supabase must never be used by the truck search path');
  }),
}));

vi.mock('../../src/config/db.js', () => ({
  supabase: { from: anonFrom, rpc: vi.fn() },
  supabaseAdmin: m.supabase,
  firebaseAdmin: null,
  redisClient: null,
  mongoDb: {
    collection: () => ({
      find: () => ({
        toArray: () => Promise.resolve(mockTelemetryResults),
      }),
    }),
  },
}));

vi.mock('../../src/services/osrm.js', () => ({
  getRouteEstimate: vi.fn().mockResolvedValue({ distanceKm: 10, durationSeconds: 1200 }),
}));
vi.mock('../../src/lib/pricing.js', () => ({
  computeOrderPricing: vi.fn().mockReturnValue({
    baseFreight: 1000,
    tollEstimate: 100,
    platformFee: 50,
    totalAmount: 1150,
    distanceKm: 10,
  }),
}));
vi.mock('../../src/services/ml.js', () => ({
  predictPrice: vi.fn().mockResolvedValue({ estimated_price: 0 }),
}));
vi.mock('../../src/services/trafficService.js', () => ({
  getLiveTrafficMultiplier: vi.fn().mockResolvedValue(1),
}));
vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => {
    req.user = {
      id: req.get('x-user-id') || 'customer-uuid-123',
      role: req.get('x-user-role') || 'customer',
    };
    next();
  },
}));
vi.mock('../../src/middleware/requirePolicy.js', () => ({
  requirePolicy: () => (_req, _res, next) => next(),
}));

const { default: truckRouter } = await import('../../src/routes/truckRoutes.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/trucks', truckRouter);
  return app;
}

const SEARCH_PARAMS = 'pickup_lat=19.0760&pickup_lng=72.8777&drop_lat=28.6139&drop_lng=77.2090&weight_tonnes=5';

describe('GET /api/trucks/search — service-role client', () => {
  beforeEach(() => {
    process.env.BYPASS_AUTH = 'true';
    process.env.NODE_ENV = 'test';
    m.store.trucks = [
      { id: 'truck-open', name: 'Open Body Truck', number_plate: 'MH12AB0001', max_capacity_tons: 10, owner_id: 'driver-uuid-456' },
    ];
    m.store.driver_details = [
      { user_id: 'driver-uuid-456', is_online: true, truck_id: 'truck-open', rating: 4.5, total_trips: 100, completion_rate: 95 },
    ];
    m.store.profiles = [
      { id: 'driver-uuid-456', full_name: 'Ravi Kumar' },
    ];
    mockTelemetryResults = [{ driver_id: 'driver-uuid-456' }];
    m.calls.length = 0;
    vi.clearAllMocks();
  });

  it('returns matching drivers enriched with truck and profile data', async () => {
    const res = await request(buildApp())
      .get(`/api/trucks/search?${SEARCH_PARAMS}`)
      .set('x-user-id', 'customer-uuid-123')
      .set('x-user-role', 'customer');

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].driver).toBe('Ravi Kumar');
    expect(res.body[0].truck).toBe('Open Body Truck');
  });

  it('runs driver_details, trucks, and profiles reads through the service-role client only', async () => {
    const res = await request(buildApp())
      .get(`/api/trucks/search?${SEARCH_PARAMS}`)
      .set('x-user-id', 'customer-uuid-123')
      .set('x-user-role', 'customer');

    expect(res.status).toBe(200);
    expect(anonFrom).not.toHaveBeenCalled();

    const readTables = m.calls.map(c => c.table);
    expect(readTables).toEqual(expect.arrayContaining(['driver_details', 'trucks', 'profiles']));
    const driverDetailsCall = m.calls.find(c => c.table === 'driver_details');
    expect(driverDetailsCall.filters).toEqual([
      { col: 'is_online', op: 'eq', val: true },
      { col: 'truck_id', op: 'not:is', val: null },
      { col: 'user_id', op: 'in', val: ['driver-uuid-456'] },
    ]);
  });
});
