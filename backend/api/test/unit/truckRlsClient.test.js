import { describe, expect, it, vi } from 'vitest';

const { anonFrom, userFrom, adminFrom, createUserClient, cache } = vi.hoisted(() => {
  const anonFrom = vi.fn(() => { throw new Error('anonymous truck access'); });
  const userFrom = vi.fn();
  const adminFrom = vi.fn();
  return { anonFrom, userFrom, adminFrom, createUserClient: vi.fn(() => ({ from: userFrom })), cache: {} };
});

vi.mock('../../src/config/db.js', () => ({
  supabase: { from: anonFrom }, supabaseAdmin: { from: adminFrom }, createUserClient,
  mongoDb: null, redisClient: null, upstashRedisClient: null,
}));
vi.mock('../../src/middleware/auth.js', () => ({ authenticate: (_req, _res, next) => next() }));
vi.mock('../../src/middleware/requirePolicy.js', () => ({ requirePolicy: () => (_req, _res, next) => next() }));
vi.mock('../../src/middleware/rateLimiter.js', () => ({ userLimiter: (_req, _res, next) => next() }));
vi.mock('../../src/middleware/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../src/middleware/cacheMiddleware.js', () => ({
  cacheMiddleware: (_ttl, prefix, keyGenerator) => {
    if (prefix === 'truck_search') cache.keyGenerator = keyGenerator;
    return (_req, _res, next) => next();
  },
}));
vi.mock('../../src/utils/cacheInvalidation.js', () => ({ getTruckSearchVersion: async () => 1 }));
vi.mock('../../src/services/osrm.js', () => ({ getRouteEstimate: vi.fn() }));
vi.mock('../../src/services/ml.js', () => ({ predictPrice: vi.fn() }));
vi.mock('../../src/services/trafficService.js', () => ({ getLiveTrafficMultiplier: vi.fn() }));
vi.mock('../../src/services/fuelAdvisorService.js', () => ({ FuelAdvisorService: class {} }));
vi.mock('../../src/services/weatherService.js', () => ({ WeatherService: class {} }));

import truckRouter from '../../src/routes/truckRoutes.js';

function handler(method, path) {
  const layer = truckRouter.stack.find((item) => item.route?.path === path && item.route.methods[method]);
  return layer.route.stack.at(-1).handle;
}
function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}
function truckQuery({ existing = null, inserted = null }) {
  const query = {
    select: () => query, eq: () => query,
    maybeSingle: async () => ({ data: existing, error: null }),
    insert: () => ({ select: () => ({ single: async () => ({ data: inserted, error: null }) }) }),
  };
  return query;
}

describe('truck routes use authenticated RLS clients', () => {
  it('registers through the caller token rather than the anon client', async () => {
    anonFrom.mockClear(); userFrom.mockReset(); createUserClient.mockClear();
    const truck = { id: 'truck-1', number_plate: 'MH12AB1234' };
    userFrom.mockReturnValue(truckQuery({ inserted: truck }));
    const res = response();
    await handler('post', '/')({
      token: 'driver-token', user: { id: 'driver-1', role: 'driver' },
      body: { name: 'Truck', truck_type: 'Open Body', number_plate: 'MH12AB1234', max_capacity_tons: 5 },
    }, res);
    expect(res.statusCode).toBe(201);
    expect(res.body.truck).toEqual(truck);
    expect(createUserClient).toHaveBeenCalledWith('driver-token');
    expect(userFrom).toHaveBeenCalledWith('trucks');
    expect(anonFrom).not.toHaveBeenCalled();
  });

  it('reads the owner’s trucks through their token', async () => {
    anonFrom.mockClear(); userFrom.mockReset(); createUserClient.mockClear();
    const query = { select: () => query, eq: () => query, order: async () => ({ data: [], error: null }) };
    userFrom.mockReturnValue(query);
    const res = response();
    await handler('get', '/')({ token: 'driver-token', user: { id: 'driver-1' }, query: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(createUserClient).toHaveBeenCalledWith('driver-token');
    expect(anonFrom).not.toHaveBeenCalled();
  });

  it('uses an admin read for a plate, then checks caller ownership', async () => {
    anonFrom.mockClear(); adminFrom.mockReset();
    adminFrom.mockReturnValue(truckQuery({ existing: { id: 'truck-1', driver_id: 'driver-1', number_plate: 'MH12AB1234' } }));
    const res = response();
    await handler('get', '/:id/number')({ params: { id: 'truck-1' }, user: { id: 'driver-1', role: 'driver' } }, res);
    expect(res.body).toEqual({ number_plate: 'MH12AB1234' });
    expect(adminFrom).toHaveBeenCalledWith('trucks');
    expect(anonFrom).not.toHaveBeenCalled();
  });

  it('separates search cache entries by caller because results can include private plates', async () => {
    const query = { pickup_lat: '19', pickup_lng: '72', drop_lat: '28', drop_lng: '77', weight_tonnes: '5' };
    const first = await cache.keyGenerator({ query, user: { id: 'driver-1' } });
    const second = await cache.keyGenerator({ query, user: { id: 'customer-2' } });
    expect(first).not.toBe(second);
  });
});
