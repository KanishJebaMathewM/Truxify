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

const { anonFrom, mockRedisClient, mockUpstashRedisClient } = vi.hoisted(() => ({
  anonFrom: vi.fn((table) => {
    if (['driver_details', 'trucks', 'profiles'].includes(table)) {
      throw new Error(`anon supabase must never be used for ${table}`);
    }
    return {
      select: () => ({
        eq: () => ({
          or: () => ({
            limit: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
        }),
      }),
    };
  }),
  mockRedisClient: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
  },
  mockUpstashRedisClient: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
  },
}));

vi.mock('../../src/config/db.js', () => ({
  supabase: { from: anonFrom, rpc: vi.fn() },
  supabaseAdmin: m.supabase,
  firebaseAdmin: null,
  redisClient: mockRedisClient,
  upstashRedisClient: mockUpstashRedisClient,
  mongoDb: {
    collection: () => ({
      find: () => ({
        limit: () => ({ toArray: () => Promise.resolve(mockTelemetryResults) }),
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
    mockRedisClient.get.mockResolvedValue(null);
    mockRedisClient.set.mockResolvedValue('OK');
    mockUpstashRedisClient.get.mockResolvedValue(null);
    mockUpstashRedisClient.set.mockResolvedValue('OK');
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
    expect(anonFrom).not.toHaveBeenCalledWith('driver_details');
    expect(anonFrom).not.toHaveBeenCalledWith('trucks');
    expect(anonFrom).not.toHaveBeenCalledWith('profiles');

    const readTables = m.calls.map(c => c.table);
    expect(readTables).toEqual(expect.arrayContaining(['driver_details', 'trucks', 'profiles']));
    const driverDetailsCall = m.calls.find(c => c.table === 'driver_details');
    expect(driverDetailsCall.filters).toEqual([
      { col: 'is_online', op: 'eq', val: true },
      { col: 'truck_id', op: 'not:is', val: null },
      { col: 'user_id', op: 'in', val: ['driver-uuid-456'] },
    ]);
  });

  it('returns empty array early when drivers have null/undefined truck_id and does not query trucks table', async () => {
    m.programData([
      { user_id: 'driver-uuid-456', is_online: true, truck_id: null, rating: 4.5, total_trips: 100, completion_rate: 95 },
    ]);

    const res = await request(buildApp())
      .get(`/api/trucks/search?${SEARCH_PARAMS}`)
      .set('x-user-id', 'customer-uuid-123')
      .set('x-user-role', 'customer');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);

    const readTables = m.calls.map(c => c.table);
    expect(readTables).toContain('driver_details');
    expect(readTables).not.toContain('trucks');
    expect(readTables).not.toContain('profiles');
  });

  it('filters out drivers with null/undefined truck_id and enriches only valid drivers', async () => {
    mockTelemetryResults = [
      { driver_id: 'driver-uuid-456' },
      { driver_id: 'driver-uuid-789' },
    ];
    m.store.profiles = [
      { id: 'driver-uuid-456', full_name: 'Ravi Kumar' },
      { id: 'driver-uuid-789', full_name: 'Suresh Singh' },
    ];
    m.programData([
      { user_id: 'driver-uuid-456', is_online: true, truck_id: 'truck-open', rating: 4.5, total_trips: 100, completion_rate: 95 },
      { user_id: 'driver-uuid-789', is_online: true, truck_id: null, rating: 4.0, total_trips: 50, completion_rate: 90 },
    ]);

    const res = await request(buildApp())
      .get(`/api/trucks/search?${SEARCH_PARAMS}`)
      .set('x-user-id', 'customer-uuid-123')
      .set('x-user-role', 'customer');

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].driverId).toBe('driver-uuid-456');
    expect(res.body[0].driver).toBe('Ravi Kumar');
    expect(res.body[0].truck).toBe('Open Body Truck');
  });

  it('returns empty array immediately when truck_id / truckId query param is null, undefined, or empty without making DB calls', async () => {
    for (const param of ['truck_id=null', 'truck_id=undefined', 'truck_id=', 'truckId=null', 'truckId=undefined']) {
      m.calls.length = 0;
      const res = await request(buildApp())
        .get(`/api/trucks/search?${SEARCH_PARAMS}&${param}`)
        .set('x-user-id', 'customer-uuid-123')
        .set('x-user-role', 'customer');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
      expect(m.calls.length).toBe(0);
    }
  });

  it('filters by valid truck_id query param', async () => {
    const res = await request(buildApp())
      .get(`/api/trucks/search?${SEARCH_PARAMS}&truck_id=truck-open`)
      .set('x-user-id', 'customer-uuid-123')
      .set('x-user-role', 'customer');

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].truck).toBe('Open Body Truck');

    const driverDetailsCall = m.calls.find(c => c.table === 'driver_details');
    expect(driverDetailsCall.filters).toContainEqual({ col: 'truck_id', op: 'eq', val: 'truck-open' });
  });

  it('gracefully handles missing truck record without throwing null-reference errors', async () => {
    m.store.driver_details = [
      { user_id: 'driver-uuid-456', is_online: true, truck_id: 'truck-nonexistent', rating: 4.5, total_trips: 100, completion_rate: 95 },
    ];
    m.store.trucks = [];

    const res = await request(buildApp())
      .get(`/api/trucks/search?${SEARCH_PARAMS}`)
      .set('x-user-id', 'customer-uuid-123')
      .set('x-user-role', 'customer');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('includes explicit truck_id in truck-search cache keys to prevent cross-truck cache collisions', async () => {
    m.store.trucks.push({
      id: 'truck-other',
      name: 'Other Truck',
      number_plate: 'MH12AB0002',
      max_capacity_tons: 10,
      owner_id: 'driver-uuid-789',
    });
    m.store.driver_details.push({
      user_id: 'driver-uuid-789',
      is_online: true,
      truck_id: 'truck-other',
      rating: 4.8,
      total_trips: 80,
      completion_rate: 98,
    });
    m.store.profiles.push({
      id: 'driver-uuid-789',
      full_name: 'Vikram Patel',
    });
    mockTelemetryResults = [{ driver_id: 'driver-uuid-456' }, { driver_id: 'driver-uuid-789' }];

    mockRedisClient.set.mockClear();
    mockUpstashRedisClient.set.mockClear();

    const res1 = await request(buildApp())
      .get(`/api/trucks/search?${SEARCH_PARAMS}&truck_id=truck-open`)
      .set('x-user-id', 'customer-uuid-123')
      .set('x-user-role', 'customer');

    expect(res1.status).toBe(200);
    expect(mockRedisClient.set).toHaveBeenCalledTimes(1);
    const [redisKey1] = mockRedisClient.set.mock.calls[0];
    expect(redisKey1).toContain('"truckId":"truck-open"');

    const [upstashKey1] = mockUpstashRedisClient.set.mock.calls[0];
    expect(upstashKey1).toContain('cache:truck_search:u:customer-uuid-123:v');

    mockRedisClient.set.mockClear();
    mockUpstashRedisClient.set.mockClear();

    const res2 = await request(buildApp())
      .get(`/api/trucks/search?${SEARCH_PARAMS}&truck_id=truck-other`)
      .set('x-user-id', 'customer-uuid-123')
      .set('x-user-role', 'customer');

    expect(res2.status).toBe(200);
    expect(mockRedisClient.set).toHaveBeenCalledTimes(1);
    const [redisKey2] = mockRedisClient.set.mock.calls[0];
    expect(redisKey2).toContain('"truckId":"truck-other"');
    expect(redisKey2).not.toEqual(redisKey1);

    const [upstashKey2] = mockUpstashRedisClient.set.mock.calls[0];
    expect(upstashKey2).not.toEqual(upstashKey1);
  });

  it('isolates truck-search cache keys by authenticated user to prevent authorization leakage', async () => {
    mockRedisClient.set.mockClear();
    mockUpstashRedisClient.set.mockClear();

    const resUserA = await request(buildApp())
      .get(`/api/trucks/search?${SEARCH_PARAMS}`)
      .set('x-user-id', 'user-A')
      .set('x-user-role', 'customer');

    expect(resUserA.status).toBe(200);
    const [redisKeyA] = mockRedisClient.set.mock.calls[0];
    const [upstashKeyA] = mockUpstashRedisClient.set.mock.calls[0];
    expect(redisKeyA).toContain('"userId":"user-A"');
    expect(upstashKeyA).toContain('cache:truck_search:u:user-A:v');

    mockRedisClient.set.mockClear();
    mockUpstashRedisClient.set.mockClear();

    const resUserB = await request(buildApp())
      .get(`/api/trucks/search?${SEARCH_PARAMS}`)
      .set('x-user-id', 'user-B')
      .set('x-user-role', 'customer');

    expect(resUserB.status).toBe(200);
    const [redisKeyB] = mockRedisClient.set.mock.calls[0];
    const [upstashKeyB] = mockUpstashRedisClient.set.mock.calls[0];
    expect(redisKeyB).toContain('"userId":"user-B"');
    expect(upstashKeyB).toContain('cache:truck_search:u:user-B:v');

    expect(redisKeyA).not.toEqual(redisKeyB);
    expect(upstashKeyA).not.toEqual(upstashKeyB);
  });
});

