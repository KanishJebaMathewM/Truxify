/**
 * Regression tests for GET /api/ml/enroute-loads coordinate handling.
 *
 * The route used to parse lat/lng with parseFloat and maxDetour with
 * `parseFloat(maxDetour || '10')`, so:
 *   - lat=999 / lng=999 were accepted and fed straight into haversine math,
 *   - maxDetour=abc became NaN, and `detour_km <= NaN` is always false, so the
 *     endpoint answered 200 with an empty list instead of a 400.
 *
 * Run with:  npm test -- test/unit/mlRoutesEnRoute.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({ default: mockLogger }));

const mlServiceMock = vi.hoisted(() => ({
  matchEnRouteLoads: vi.fn(),
}));

vi.mock('../../src/services/ml.js', () => ({
  predictDemand: vi.fn(),
  predictPrice: vi.fn(),
  predictEta: vi.fn(),
  matchEnRouteLoads: mlServiceMock.matchEnRouteLoads,
}));

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, res, next) => {
    req.user = { id: 'driver-1', role: 'driver' };
    next();
  },
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  userLimiter: (req, res, next) => next(),
}));

const redisGet = vi.hoisted(() => vi.fn().mockResolvedValue(null));
const redisSet = vi.hoisted(() => vi.fn().mockResolvedValue('OK'));
const supabaseFrom = vi.hoisted(() => vi.fn());

vi.mock('../../src/config/db.js', () => ({
  supabase: { from: supabaseFrom },
  supabaseAdmin: { from: supabaseFrom },
  upstashRedisClient: { get: redisGet, set: redisSet },
}));

const { default: mlRouter } = await import('../../src/routes/mlRoutes.js');

function makeApp() {
  const app = express();
  app.use('/api/ml', mlRouter);
  return app;
}

/** Minimal Supabase query-builder stub: offers list, then driver_details/trucks lookups. */
function stubSupabase() {
  supabaseFrom.mockImplementation((table) => {
    if (table === 'load_offers') {
      return {
        select: () => ({
          eq: async () => ({ data: [], error: null }),
        }),
      };
    }
    return {
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
      }),
    };
  });
}

describe('GET /api/ml/enroute-loads coordinate validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisGet.mockResolvedValue(null);
    redisSet.mockResolvedValue('OK');
    mlServiceMock.matchEnRouteLoads.mockResolvedValue([]);
    stubSupabase();
  });

  it('rejects a missing latitude', async () => {
    const res = await request(makeApp()).get('/api/ml/enroute-loads?lng=72.87');
    expect(res.status).toBe(400);
    expect(mlServiceMock.matchEnRouteLoads).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric latitude', async () => {
    const res = await request(makeApp()).get('/api/ml/enroute-loads?lat=abc&lng=72.87');
    expect(res.status).toBe(400);
    expect(mlServiceMock.matchEnRouteLoads).not.toHaveBeenCalled();
  });

  it('rejects out-of-range latitudes', async () => {
    for (const lat of ['90.0001', '-90.0001', '999', '-999']) {
      const res = await request(makeApp()).get(`/api/ml/enroute-loads?lat=${lat}&lng=72.87`);
      expect(res.status, `lat=${lat} should be rejected`).toBe(400);
    }
    expect(mlServiceMock.matchEnRouteLoads).not.toHaveBeenCalled();
  });

  it('rejects out-of-range longitudes', async () => {
    for (const lng of ['180.0001', '-180.0001', '999', '-999']) {
      const res = await request(makeApp()).get(`/api/ml/enroute-loads?lat=19.07&lng=${lng}`);
      expect(res.status, `lng=${lng} should be rejected`).toBe(400);
    }
    expect(mlServiceMock.matchEnRouteLoads).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric maxDetour instead of silently returning no matches', async () => {
    const res = await request(makeApp()).get('/api/ml/enroute-loads?lat=19.07&lng=72.87&maxDetour=abc');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('maxDetour');
    expect(mlServiceMock.matchEnRouteLoads).not.toHaveBeenCalled();
  });

  it('rejects a non-positive or non-finite maxDetour', async () => {
    for (const maxDetour of ['0', '-5', 'NaN', 'Infinity', '1e999']) {
      const res = await request(makeApp()).get(
        `/api/ml/enroute-loads?lat=19.07&lng=72.87&maxDetour=${maxDetour}`,
      );
      expect(res.status, `maxDetour=${maxDetour} should be rejected`).toBe(400);
    }
    expect(mlServiceMock.matchEnRouteLoads).not.toHaveBeenCalled();
  });

  it('rejects a maxDetour beyond the supported ceiling', async () => {
    const res = await request(makeApp()).get('/api/ml/enroute-loads?lat=19.07&lng=72.87&maxDetour=100000');
    expect(res.status).toBe(400);
  });

  it('accepts 0 as a real coordinate', async () => {
    const res = await request(makeApp()).get('/api/ml/enroute-loads?lat=0&lng=0');
    expect(res.status).toBe(200);
    expect(mlServiceMock.matchEnRouteLoads).toHaveBeenCalledWith(
      expect.objectContaining({ currentLat: 0, currentLng: 0 }),
    );
  });

  it('accepts the exact range boundaries', async () => {
    const res = await request(makeApp()).get('/api/ml/enroute-loads?lat=-90&lng=-180');
    expect(res.status).toBe(200);
    expect(mlServiceMock.matchEnRouteLoads).toHaveBeenCalledWith(
      expect.objectContaining({ currentLat: -90, currentLng: -180 }),
    );
  });

  it('defaults maxDetourKm to 10 when the parameter is omitted', async () => {
    const res = await request(makeApp()).get('/api/ml/enroute-loads?lat=19.07&lng=72.87');
    expect(res.status).toBe(200);
    expect(mlServiceMock.matchEnRouteLoads).toHaveBeenCalledWith(
      expect.objectContaining({ maxDetourKm: 10 }),
    );
  });

  it('forwards a valid maxDetourKm to the service', async () => {
    const res = await request(makeApp()).get('/api/ml/enroute-loads?lat=19.07&lng=72.87&maxDetour=25');
    expect(res.status).toBe(200);
    expect(mlServiceMock.matchEnRouteLoads).toHaveBeenCalledWith(
      expect.objectContaining({ maxDetourKm: 25 }),
    );
  });
});
