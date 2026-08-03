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

const mockOptimiseMidTrip = vi.fn();
vi.mock('../../src/services/ml.js', () => ({
  optimiseMidTrip: (...args) => mockOptimiseMidTrip(...args),
}));

const { default: mlRouter } = await import('../../src/routes/mlRoutes.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/ml', mlRouter);
  return app;
}

const DRIVER_HEADERS = {
  'x-user-id': 'driver-uuid-123',
  'x-user-role': 'driver',
  'x-user-name': 'Test Driver',
};

describe('ML Routes - En-Route Loads', () => {
  beforeEach(() => {
    process.env.BYPASS_AUTH = 'true';
    process.env.NODE_ENV = 'test';
    process.env.ML_API_KEY = 'test-key';
    vi.clearAllMocks();
    m.calls.length = 0;
    m.store.load_offers = [];
    m.store.driver_details = [];
    m.store.trucks = [];
    m.store.trips = [];
    m.store.route_map_points = [];
  });

  describe('GET /api/ml/en-route-loads', () => {
    it('returns 401 when x-user-id header is missing', async () => {
      const res = await request(buildApp())
        .get('/api/ml/en-route-loads?currentLat=19.076&currentLng=72.8777');

      expect(res.status).toBe(401);
    });

    it('falls back to static database-driven en-route loads when coordinates are missing', async () => {
      m.store.load_offers = [
        {
          id: 'load-static-1',
          route_label: 'Static Route',
          is_en_route: true,
          status: 'available',
        },
      ];

      const res = await request(buildApp())
        .get('/api/ml/en-route-loads')
        .set(DRIVER_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body).toBeInstanceOf(Array);
      expect(res.body[0].id).toBe('load-static-1');
    });

    it('returns optimized en-route loads from ML mid-trip reoptimiser', async () => {
      // Seed mock store tables
      m.store.driver_details = [
        { user_id: 'driver-uuid-123', truck_id: 'truck-uuid-123' },
      ];
      m.store.trucks = [
        {
          id: 'truck-uuid-123',
          max_capacity_tons: 15,
          cargo_length_ft: 20,
          cargo_width_ft: 8,
          cargo_height_ft: 8,
        },
      ];
      m.store.trips = [
        { id: 'trip-1', trip_display_id: '#TX1001', driver_id: 'driver-uuid-123', status: 'active' },
      ];
      m.store.route_map_points = [
        { trip_display_id: '#TX1001', latitude: 19.123, longitude: 72.956, is_claimed: false, sort_order: 1 },
      ];
      m.store.load_offers = [
        {
          id: 'load-opt-123',
          order_display_id: '#FF999',
          pickup_lat: 19.1,
          pickup_lng: 72.9,
          drop_lat: 28.6,
          drop_lng: 77.2,
          net_profit: 35000,
          weight: '3 tonnes',
          dimensions: '12x6x6 ft',
          status: 'available',
        },
      ];

      // Mock ML call
      mockOptimiseMidTrip.mockResolvedValueOnce({
        recommendations: [
          {
            load_id: 'load-opt-123',
            detour_km: 15.5,
            detour_minutes: 25.0,
            additional_earnings: 350.0,
            priority_score: 85.0,
          },
        ],
      });

      const res = await request(buildApp())
        .get('/api/ml/en-route-loads?currentLat=19.076&currentLng=72.8777')
        .set(DRIVER_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body).toBeInstanceOf(Array);
      expect(res.body.length).toBe(1);
      expect(res.body[0].id).toBe('load-opt-123');
      expect(res.body[0].is_en_route).toBe(true);
      expect(res.body[0].extra_distance_km).toBe(16);
      expect(res.body[0].extra_earnings).toBe(35000);
    });
  });
});
