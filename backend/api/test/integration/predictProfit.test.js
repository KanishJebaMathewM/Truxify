/**
 * Integration tests for POST /api/driver/predict-profit
 *
 * Covers:
 *   - Successful ML prediction with valid payload
 *   - Validation: rejects missing / invalid fields
 *   - ML engine unavailable (503)
 *   - Auth: requires authentication
 *   - ML engine errors (500)
 *
 * Run with:  npm run test:integration -- test/integration/predictProfit.test.js
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

const { createSupabaseMock } = await vi.importActual('../helpers/supabaseMock.js');
const m = createSupabaseMock();

vi.mock('../../src/config/db.js', () => ({
  supabase: m.supabase,
  firebaseAdmin: null,
  redisClient: null,
  mongoDb: null,
}));

vi.mock('../../src/services/reputation.js', () => ({
  reputationContract: {},
  awardReputationPoints: vi.fn(),
  getDriverReputation: vi.fn(),
}));

const mockPredictDriverProfit = vi.fn();
vi.mock('../../src/services/ml.js', () => ({
  predictDriverProfit: mockPredictDriverProfit,
}));

const { default: driverRouter } = await import('../../src/routes/driverRoutes.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/driver', driverRouter);
  return app;
}

const DRIVER_HEADERS = {
  'x-user-id': 'driver-1',
  'x-user-role': 'driver',
};

const VALID_PAYLOAD = {
  route_distance_km: 500,
  fuel_price_per_litre: 102,
  toll_estimate_inr: 1500,
  truck_mileage_kml: 6,
  cargo_weight_kg: 5000,
  trip_duration_hours: 10,
};

describe('POST /api/driver/predict-profit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.store.driver_details = [];
    m.calls.length = 0;
  });

  it('returns prediction on valid payload', async () => {
    mockPredictDriverProfit.mockResolvedValueOnce({
      predicted_profit: 8500,
      confidence_interval: { lower: 7000, upper: 10000 },
      currency: 'INR',
    });

    const app = buildApp();
    const res = await request(app)
      .post('/api/driver/predict-profit')
      .set(DRIVER_HEADERS)
      .send(VALID_PAYLOAD);

    expect(res.status).toBe(200);
    expect(res.body.prediction).toMatchObject({
      predicted_profit: 8500,
      confidence_interval: { lower: 7000, upper: 10000 },
      currency: 'INR',
    });
    expect(mockPredictDriverProfit).toHaveBeenCalledWith({
      routeDistanceKm: 500,
      fuelPricePerLitre: 102,
      tollEstimateInr: 1500,
      truckMileageKmL: 6,
      cargoWeightKg: 5000,
      tripDurationHours: 10,
    });
  });

  it('rejects missing required fields', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/driver/predict-profit')
      .set(DRIVER_HEADERS)
      .send({ route_distance_km: 500 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('rejects non-positive values', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/driver/predict-profit')
      .set(DRIVER_HEADERS)
      .send({ ...VALID_PAYLOAD, route_distance_km: -100 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('rejects unknown fields (strict mode)', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/driver/predict-profit')
      .set(DRIVER_HEADERS)
      .send({ ...VALID_PAYLOAD, extra_field: 'bad' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('returns 503 when ML engine is unavailable', async () => {
    mockPredictDriverProfit.mockRejectedValueOnce(
      new Error('[ML] ML_API_KEY is not configured.')
    );

    const app = buildApp();
    const res = await request(app)
      .post('/api/driver/predict-profit')
      .set(DRIVER_HEADERS)
      .send(VALID_PAYLOAD);

    expect(res.status).toBe(503);
    expect(res.body.error).toContain('temporarily unavailable');
  });

  it('returns 500 on unexpected ML error', async () => {
    mockPredictDriverProfit.mockRejectedValueOnce(
      new Error('Something went wrong')
    );

    const app = buildApp();
    const res = await request(app)
      .post('/api/driver/predict-profit')
      .set(DRIVER_HEADERS)
      .send(VALID_PAYLOAD);

    expect(res.status).toBe(500);
    expect(res.body.error).toContain('prediction failed');
  });

  it('requires authentication', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/driver/predict-profit')
      .send(VALID_PAYLOAD);

    expect(res.status).toBe(401);
  });

  it('allows toll_estimate_inr to be zero', async () => {
    mockPredictDriverProfit.mockResolvedValueOnce({
      predicted_profit: 9000,
      confidence_interval: { lower: 7500, upper: 10500 },
      currency: 'INR',
    });

    const app = buildApp();
    const res = await request(app)
      .post('/api/driver/predict-profit')
      .set(DRIVER_HEADERS)
      .send({ ...VALID_PAYLOAD, toll_estimate_inr: 0 });

    expect(res.status).toBe(200);
    expect(res.body.prediction.predicted_profit).toBe(9000);
  });
});
