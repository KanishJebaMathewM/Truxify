import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ role: 'admin', recommendation: vi.fn(), from: vi.fn() }));
vi.mock('../../src/config/db.js', () => ({ supabase: {}, supabaseAdmin: {}, redisClient: null,
  mongoDb: null, createUserClient: () => ({ from: state.from }) }));
vi.mock('../../src/middleware/auth.js', () => ({ authenticate: (req, _res, next) => {
  req.user = { id: 'driver-a', role: state.role }; req.token = 'test-token'; next();
} }));
vi.mock('../../src/middleware/requirePolicy.js', () => ({ requirePolicy: () => (_req, _res, next) => next() }));
vi.mock('../../src/middleware/rateLimiter.js', () => ({ userLimiter: (_req, _res, next) => next() }));
vi.mock('../../src/middleware/cacheMiddleware.js', () => ({ cacheMiddleware: () => (_req, _res, next) => next() }));
vi.mock('../../src/utils/cacheInvalidation.js', () => ({ getTruckSearchVersion: vi.fn() }));
vi.mock('../../src/middleware/logger.js', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('../../src/services/osrm.js', () => ({ getRouteEstimate: vi.fn() }));
vi.mock('../../src/lib/pricing.js', () => ({ computeOrderPricing: vi.fn() }));
vi.mock('../../src/services/ml.js', () => ({ predictPrice: vi.fn() }));
vi.mock('../../src/services/trafficService.js', () => ({ getLiveTrafficMultiplier: vi.fn() }));
vi.mock('../../src/services/weatherService.js', () => ({ WeatherService: class {} }));
vi.mock('../../src/services/fuelAdvisorService.js', () => ({ FuelAdvisorService: class {
  getFuelRecommendation(...args) { return state.recommendation(...args); }
} }));

import truckRoutes from '../../src/routes/truckRoutes.js';
const truckId = '550e8400-e29b-41d4-a716-446655440000';
const app = express();
app.use('/trucks', truckRoutes);
const endpoint = `/trucks/${truckId}/fuel-advisor`;

describe('fuel advice destination validation at the mounted route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.role = 'admin';
    state.recommendation.mockResolvedValue({ recommended_blend: 'B20' });
  });

  it.each([
    ['', '77.2'], ['   ', '77.2'], ['91', '77.2'], ['-91', '77.2'],
    ['28.6', '181'], ['28.6', '-181'], ['NaN', '77.2'], [undefined, '77.2'],
  ])('rejects invalid destination %s,%s before downstream work', async (lat, lng) => {
    const query = { destination_lng: lng };
    if (lat !== undefined) query.destination_lat = lat;
    const response = await request(app).get(endpoint).query(query);
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Missing or invalid destination_lat or destination_lng');
    expect(state.recommendation).not.toHaveBeenCalled();
    expect(state.from).not.toHaveBeenCalled();
  });

  it.each([[0, 0], [90, 180], [-90, -180], [28.6, 77.2]])('passes valid destination %s,%s as numbers', async (lat, lng) => {
    const response = await request(app).get(endpoint).query({ destination_lat: String(lat), destination_lng: String(lng) });
    expect(response.status).toBe(200);
    expect(state.recommendation).toHaveBeenCalledWith(truckId, lat, lng);
  });

  it('keeps driver ownership checks after successful coordinate validation', async () => {
    state.role = 'driver';
    const chain = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
    state.from.mockReturnValue(chain);
    const response = await request(app).get(endpoint).query({ destination_lat: '28.6', destination_lng: '77.2' });
    expect(response.status).toBe(403);
    expect(chain.eq).toHaveBeenCalledWith('driver_id', 'driver-a');
    expect(state.recommendation).not.toHaveBeenCalled();
  });
});
