import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const mocks = vi.hoisted(() => ({ predict: vi.fn(), client: vi.fn() }));
vi.mock('../../src/config/db.js', () => ({ createUserClient: mocks.client }));
vi.mock('../../src/middleware/auth.js', () => ({ authenticate: (req, _res, next) => {
  req.user = { id: 'driver' }; req.token = 'test-jwt'; next();
} }));
vi.mock('../../src/middleware/rateLimiter.js', () => ({ userLimiter: (_req, _res, next) => next() }));
vi.mock('../../src/middleware/requirePolicy.js', () => ({ requirePolicy: () => (_req, _res, next) => next() }));
vi.mock('../../src/middleware/logger.js', () => ({ default: { warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../src/services/ml.js', () => ({ predictDemand: mocks.predict }));

let app;
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  for (const key of ['DEMAND_BASE_EARNING_RATE', 'DEMAND_ROUTE_MULTIPLIER_BASE',
    'DEMAND_ROUTE_MULTIPLIER_STEP', 'DEMAND_NEXT_24H_FACTOR', 'DEMAND_NEXT_48H_FACTOR']) {
    vi.stubEnv(key, '');
  }
  mocks.client.mockReturnValue({ from: () => ({ select() { return this; },
    in() { return this; }, limit: async () => ({ data: [
      { pickup_address: 'Depot', drop_address: 'Delivery', pickup_lat: 13, pickup_lng: 80 },
    ], error: null }) }) });
  const { default: router } = await import('../../src/routes/demandRoutes.js');
  app = express(); app.use('/demand', router);
});
afterEach(() => vi.unstubAllEnvs());

describe('demand heatmap forecast values', () => {
  it('preserves an explicit zero forecast in earnings, confidence and both horizons', async () => {
    mocks.predict.mockResolvedValue({ predicted_demand: 0 });
    const reply = await request(app).get('/demand');
    expect(reply.status).toBe(200);
    expect(reply.body.estimatedEarningPotential).toBe(18.5);
    expect(reply.body.routeSuggestions[0].estimatedEarnings).toBeCloseTo(22.2);
    expect(reply.body.routeSuggestions[0].confidenceScore).toBe(0);
    expect(reply.body.predictedDemandNext48Hours).toMatchObject({ next24Hours: 0, next48Hours: 0 });
  });
  it('retains positive model forecasts', async () => {
    mocks.predict.mockResolvedValue({ predicted_demand: 0.8 });
    const reply = await request(app).get('/demand');
    expect(reply.status).toBe(200);
    expect(reply.body.estimatedEarningPotential).toBe(33.3);
    expect(reply.body.routeSuggestions[0].confidenceScore).toBe(80);
    expect(reply.body.predictedDemandNext48Hours).toMatchObject({ next24Hours: 0.88, next48Hours: 0.76 });
  });
  it.each([undefined, null])('retains the fallback for an absent forecast (%s)', async predicted_demand => {
    mocks.predict.mockResolvedValue({ predicted_demand });
    const reply = await request(app).get('/demand');
    expect(reply.status).toBe(200);
    expect(reply.body.estimatedEarningPotential).toBe(27.75);
    expect(reply.body.routeSuggestions[0].confidenceScore).toBe(50);
  });
  it('retains the existing fallback when prediction fails', async () => {
    mocks.predict.mockRejectedValue(new Error('ML unavailable'));
    const reply = await request(app).get('/demand');
    expect(reply.status).toBe(200);
    expect(reply.body.estimatedEarningPotential).toBe(27.75);
    expect(reply.body.routeSuggestions[0].confidenceScore).toBe(50);
  });
});
