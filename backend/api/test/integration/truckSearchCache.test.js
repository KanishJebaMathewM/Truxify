import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

const { createSupabaseMock } = await vi.importActual('../helpers/supabaseMock.js');
const m = createSupabaseMock();
const redisClient = {
  get: vi.fn(),
  set: vi.fn(),
};

let mockTelemetryResults = [];

vi.mock('../../src/config/db.js', () => ({
  supabase: m.supabase,
  supabaseAdmin: m.supabase,
  firebaseAdmin: null,
  redisClient,
  // The cache middleware reads the Upstash client directly.
  upstashRedisClient: redisClient,
  // The route builds a caller-scoped client via createUserClient.
  createUserClient: () => m.supabase,
  mongoDb: {
    collection: () => ({
      // The handler chains .find().limit(200).toArray()
      find: () => ({
        limit: () => ({
          toArray: () => Promise.resolve(mockTelemetryResults),
        }),
      }),
    }),
  },
}));

vi.mock('../../src/services/osrm.js', () => ({ getRouteEstimate: vi.fn().mockResolvedValue({ distanceKm: 10, durationSeconds: 1200 }) }));
vi.mock('../../src/lib/pricing.js', () => ({ computeOrderPricing: vi.fn().mockReturnValue({ baseFreight: 1000, tollEstimate: 100, platformFee: 50, totalAmount: 1150, distanceKm: 10 }) }));
vi.mock('../../src/services/ml.js', () => ({ predictPrice: vi.fn().mockResolvedValue({ estimated_price: 0 }) }));
vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, res, next) => {
    req.user = {
      id: req.get('x-user-id') || 'customer-uuid-123',
      role: req.get('x-user-role') || 'customer',
      fullName: req.get('x-user-name') || 'Test Customer',
    };
    next();
  },
}));
vi.mock('../../src/middleware/requirePolicy.js', () => ({
  requirePolicy: () => (req, res, next) => next(),
}));

const { default: truckRouter } = await import('../../src/routes/truckRoutes.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/trucks', truckRouter);
  return app;
}

describe('truck search caching', () => {
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
    m.calls.length = 0;
    mockTelemetryResults = [{ driver_id: 'driver-uuid-456' }];
    redisClient.get.mockResolvedValue(null);
    redisClient.set.mockResolvedValue('OK');
    vi.clearAllMocks();
  });

  it('stores computed results with a key that includes search filters', async () => {
    const res = await request(buildApp())
      .get('/api/trucks/search?pickup_lat=19.0760&pickup_lng=72.8777&drop_lat=28.6139&drop_lng=77.2090&weight_tonnes=5&truck_type=Open%20Body&material_type=Textile')
      .set({
        'x-user-id': 'customer-uuid-123',
        'x-user-role': 'customer',
        'x-user-name': 'Test Customer',
      });

    if (res.status !== 200) console.log('PROBE-BODY:', res.status, JSON.stringify(res.body), (res.text || ''));
    process.on('uncaughtException', e => console.log('PROBE-UNCAUGHT:', e.message, e.stack?.split('\n')[1]));
    expect(res.status).toBe(200);
    expect(redisClient.set).toHaveBeenCalledTimes(1);
    const [cacheKey, cachedPayload, options] = redisClient.set.mock.calls[0];
    // cacheMiddleware namespacing + hashed filters (raw filters no longer
    // appear in keys — deliberate), upstash options-object TTL.
    expect(cacheKey).toMatch(/^cache:truck_search:/);
    expect(cachedPayload).toEqual(res.body);
    expect(options).toEqual({ ex: 30 });
  });
});
