import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

const m = (await import('../helpers/supabaseMock.js')).createSupabaseMock();

vi.mock('../../src/config/db.js', () => ({
  supabase: m.supabase,
  firebaseAdmin: null,
  redisClient: null,
  mongoDb: null,
}));

const mockMatchDeadhead = vi.fn();
vi.mock('../../src/services/ml.js', () => ({
  matchDeadhead: (...args) => mockMatchDeadhead(...args),
}));

const { default: deadheadRouter } = await import('../../src/routes/deadheadRoutes.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/driver', deadheadRouter);
  return app;
}

const DRIVER_HEADERS = {
  'x-user-id': 'driver-uuid-123',
  'x-user-role': 'driver',
  'x-user-name': 'Test Driver',
};

const VALID_PAYLOAD = {
  driver_destination: { lat: 19.076, lng: 72.8777 },
  truck_specs: {
    max_weight_kg: 25000,
    max_length_m: 12,
    max_width_m: 2.5,
    max_height_m: 4,
  },
  arrival_time: new Date(Date.now() + 3600000).toISOString(),
  available_loads: [
    {
      load_id: 'load-1',
      origin_lat: 19.08,
      origin_lng: 72.88,
      dest_lat: 28.61,
      dest_lng: 77.23,
      weight_kg: 5000,
      length_m: 6,
      width_m: 2,
      height_m: 2,
      pickup_deadline: new Date(Date.now() + 86400000).toISOString(),
      payment_inr: 15000,
    },
  ],
};

describe('Deadhead Routes', () => {
  beforeEach(() => {
    process.env.BYPASS_AUTH = 'true';
    process.env.NODE_ENV = 'test';
    process.env.ML_API_KEY = 'test-key';
    vi.clearAllMocks();
    m.calls.length = 0;
  });

  describe('POST /api/driver/match/deadhead', () => {
    it('returns 401 when x-user-id header is missing', async () => {
      const res = await request(buildApp())
        .post('/api/driver/match/deadhead')
        .send(VALID_PAYLOAD);

      expect(res.status).toBe(401);
    });

    it('returns 400 for invalid payload', async () => {
      const res = await request(buildApp())
        .post('/api/driver/match/deadhead')
        .set(DRIVER_HEADERS)
        .send({ driver_destination: { lat: 999 } });

      expect(res.status).toBe(400);
    });

    it('returns 400 when available_loads is empty', async () => {
      const res = await request(buildApp())
        .post('/api/driver/match/deadhead')
        .set(DRIVER_HEADERS)
        .send({ ...VALID_PAYLOAD, available_loads: [] });

      expect(res.status).toBe(400);
    });

    it('returns 200 with ML recommendations', async () => {
      mockMatchDeadhead.mockResolvedValueOnce({
        recommendations: [
          {
            load_id: 'load-1',
            distance_to_pickup_km: 12.5,
            match_score: 85.2,
            detour_km: 12.5,
            estimated_earnings: 15000,
          },
        ],
      });

      const res = await request(buildApp())
        .post('/api/driver/match/deadhead')
        .set(DRIVER_HEADERS)
        .send(VALID_PAYLOAD);

      expect(res.status).toBe(200);
      expect(res.body.recommendations).toHaveLength(1);
      expect(res.body.recommendations[0].match_score).toBe(85.2);
      expect(mockMatchDeadhead).toHaveBeenCalledWith({
        driverDestination: VALID_PAYLOAD.driver_destination,
        truckSpecs: VALID_PAYLOAD.truck_specs,
        arrivalTime: VALID_PAYLOAD.arrival_time,
        availableLoads: VALID_PAYLOAD.available_loads,
      });
    });

    it('returns 503 when ML engine is unavailable', async () => {
      mockMatchDeadhead.mockRejectedValueOnce(new Error('[ML] Auth failed'));

      const res = await request(buildApp())
        .post('/api/driver/match/deadhead')
        .set(DRIVER_HEADERS)
        .send(VALID_PAYLOAD);

      expect(res.status).toBe(503);
    });

    it('returns 500 when ML engine throws generic error', async () => {
      mockMatchDeadhead.mockRejectedValueOnce(new Error('Network error'));

      const res = await request(buildApp())
        .post('/api/driver/match/deadhead')
        .set(DRIVER_HEADERS)
        .send(VALID_PAYLOAD);

      expect(res.status).toBe(500);
    });
  });
});
