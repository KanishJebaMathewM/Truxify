import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

const { createSupabaseMock } = await vi.importActual('../helpers/supabaseMock.js');
const m = createSupabaseMock();

let mockTelemetryResults = [];

vi.mock('../../src/config/db.js', () => ({
  supabase: m.supabase,
  firebaseAdmin: null,
  redisClient: null,
  mongoDb: {
    collection: (name) => ({
      find: () => ({
        toArray: () => Promise.resolve(mockTelemetryResults),
      }),
    }),
  },
}));

// Stub out external service calls so the /search route doesn't fail
vi.mock('../../src/services/osrm.js', () => ({ getRouteEstimate: vi.fn().mockResolvedValue({ distanceKm: 10, durationSeconds: 1200 }) }));
vi.mock('../../src/lib/pricing.js', () => ({ computeOrderPricing: vi.fn().mockReturnValue({ baseFreight: 1000, tollEstimate: 100, platformFee: 50, totalAmount: 1150, distanceKm: 10 }) }));
vi.mock('../../src/services/ml.js', () => ({ predictPrice: vi.fn().mockResolvedValue({ estimated_price: 0 }) }));

const { default: truckRouter } = await import('../../src/routes/truckRoutes.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/trucks', truckRouter);
  return app;
}

const DRIVER_HEADERS = {
  'x-user-id': 'driver-uuid-456',
  'x-user-role': 'driver',
  'x-user-name': 'Test Driver',
};

const CUSTOMER_HEADERS = {
  'x-user-id': 'customer-uuid-123',
  'x-user-role': 'customer',
  'x-user-name': 'Test Customer',
};

describe('Truck Routes', () => {
  beforeEach(() => {
    process.env.BYPASS_AUTH = 'true';
    process.env.NODE_ENV = 'test';
    m.store.trucks = [];
    m.store.driver_details = [];
    m.store.profiles = [];
    m.calls.length = 0;
    mockTelemetryResults = [];
    vi.clearAllMocks();
  });

  describe('POST /api/trucks', () => {
    it('returns 403 for non-driver role', async () => {
      const res = await request(buildApp())
        .post('/api/trucks')
        .set(CUSTOMER_HEADERS)
        .send({ name: 'My Truck', number_plate: 'MH12AB1234', max_capacity_tons: 5 });

      expect(res.status).toBe(403);
    });

    it('registers a truck for an authenticated driver', async () => {
      const res = await request(buildApp())
        .post('/api/trucks')
        .set(DRIVER_HEADERS)
        .send({ name: 'Big Blue', number_plate: 'MH12AB1234', max_capacity_tons: 10 });

      expect(res.status).toBe(201);
      expect(res.body.message).toBe('Truck registered successfully.');
      expect(res.body.truck).toBeDefined();
      expect(res.body.truck.number_plate).toBe('MH12AB1234');

      // Verify truck was inserted into store
      const insertCall = m.calls.find(c => c.table === 'trucks' && c.mode === 'insert');
      expect(insertCall).toBeDefined();
      expect(insertCall.payload.owner_id).toBe('driver-uuid-456');
      expect(insertCall.payload.max_capacity_tons).toBe(10);
    });

    it('normalises number plate to uppercase', async () => {
      const res = await request(buildApp())
        .post('/api/trucks')
        .set(DRIVER_HEADERS)
        .send({ name: 'Red Rig', number_plate: 'mh12ab5678', max_capacity_tons: 8 });

      expect(res.status).toBe(201);
      const insertCall = m.calls.find(c => c.table === 'trucks' && c.mode === 'insert');
      expect(insertCall.payload.number_plate).toBe('MH12AB5678');
    });

    it('returns 400 for missing required fields', async () => {
      const res = await request(buildApp())
        .post('/api/trucks')
        .set(DRIVER_HEADERS)
        .send({ name: 'Missing plate' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
    });

    it('returns 400 for invalid number plate format', async () => {
      const res = await request(buildApp())
        .post('/api/trucks')
        .set(DRIVER_HEADERS)
        .send({ name: 'Bad Plate', number_plate: 'INVALID-PLATE', max_capacity_tons: 5 });

      expect(res.status).toBe(400);
    });

    it('returns 400 for zero or negative capacity', async () => {
      const res = await request(buildApp())
        .post('/api/trucks')
        .set(DRIVER_HEADERS)
        .send({ name: 'Tiny', number_plate: 'MH12AB9999', max_capacity_tons: 0 });

      expect(res.status).toBe(400);
    });

    it('returns 409 when number plate is already registered', async () => {
      // Pre-seed the plate as already existing
      m.store.trucks.push({ id: 'truck-existing', number_plate: 'MH12AB1234', owner_id: 'other-driver' });

      const res = await request(buildApp())
        .post('/api/trucks')
        .set(DRIVER_HEADERS)
        .send({ name: 'Duplicate', number_plate: 'MH12AB1234', max_capacity_tons: 5 });

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('already registered');
    });

    it('normalises number plate to uppercase and trims whitespaces', async () => {
      const res = await request(buildApp())
        .post('/api/trucks')
        .set(DRIVER_HEADERS)
        .send({ name: 'Big Blue', number_plate: '  mh12ab1234  ', max_capacity_tons: 10 });

      expect(res.status).toBe(201);
      const insertCall = m.calls.find(c => c.table === 'trucks' && c.mode === 'insert');
      expect(insertCall.payload.number_plate).toBe('MH12AB1234');
    });
  });

  describe('GET /api/trucks', () => {
    it('returns 403 for non-driver role', async () => {
      const res = await request(buildApp())
        .get('/api/trucks')
        .set(CUSTOMER_HEADERS);

      expect(res.status).toBe(403);
    });

    it('returns empty list when driver has no trucks', async () => {
      const res = await request(buildApp())
        .get('/api/trucks')
        .set(DRIVER_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body.trucks).toEqual([]);
    });

    it('returns only trucks belonging to the authenticated driver', async () => {
      m.store.trucks.push(
        { id: 'truck-1', name: 'Truck A', number_plate: 'MH12AB0001', max_capacity_tons: 5, owner_id: 'driver-uuid-456', created_at: '2026-06-01T00:00:00Z' },
        { id: 'truck-2', name: 'Truck B', number_plate: 'MH12AB0002', max_capacity_tons: 10, owner_id: 'driver-uuid-456', created_at: '2026-06-02T00:00:00Z' },
        { id: 'truck-other', name: 'Other Driver Truck', number_plate: 'DL01C9999', max_capacity_tons: 15, owner_id: 'another-driver', created_at: '2026-06-01T00:00:00Z' },
      );

      const res = await request(buildApp())
        .get('/api/trucks')
        .set(DRIVER_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body.trucks).toHaveLength(2);
      expect(res.body.trucks.map(t => t.id)).toContain('truck-1');
      expect(res.body.trucks.map(t => t.id)).toContain('truck-2');
      expect(res.body.trucks.map(t => t.id)).not.toContain('truck-other');
    });

    it('supports name filtering using name query param', async () => {
      m.store.trucks.push(
        { id: 'truck-1', name: 'Big Blue Truck', number_plate: 'MH12AB0001', max_capacity_tons: 5, owner_id: 'driver-uuid-456', created_at: '2026-06-01T00:00:00Z' },
        { id: 'truck-2', name: 'Tiny Red Truck', number_plate: 'MH12AB0002', max_capacity_tons: 10, owner_id: 'driver-uuid-456', created_at: '2026-06-02T00:00:00Z' }
      );

      const res = await request(buildApp())
        .get('/api/trucks?name=blue')
        .set(DRIVER_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body.trucks).toHaveLength(1);
      expect(res.body.trucks[0].id).toBe('truck-1');
    });
  });

  describe('GET /api/trucks/search', () => {
    const SEARCH_PARAMS = 'pickup_lat=19.0760&pickup_lng=72.8777&drop_lat=28.6139&drop_lng=77.2090&weight_tonnes=5';

    function seedSearchData() {
      mockTelemetryResults = [{ driver_id: 'driver-uuid-456' }];
      m.store.trucks = [
        { id: 'truck-open', name: 'Open Body Truck', number_plate: 'MH12AB0001', max_capacity_tons: 10, owner_id: 'driver-uuid-456' },
      ];
      m.store.driver_details = [
        { user_id: 'driver-uuid-456', is_online: true, truck_id: 'truck-open', rating: 4.5, total_trips: 100, completion_rate: 95 },
      ];
      m.store.profiles = [
        { id: 'driver-uuid-456', full_name: 'Ravi Kumar' },
      ];
    }

    it('returns 400 when required parameters are missing', async () => {
      const res = await request(buildApp())
        .get('/api/trucks/search')
        .set(CUSTOMER_HEADERS);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Missing required query parameters');
    });

    it('returns trucks for valid search without filters', async () => {
      seedSearchData();
      const res = await request(buildApp())
        .get(`/api/trucks/search?${SEARCH_PARAMS}`)
        .set(CUSTOMER_HEADERS);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body[0].driver).toBe('Ravi Kumar');
      expect(res.body[0].truck).toBe('Open Body Truck');
    });

    it('returns 400 for invalid truck_type', async () => {
      const res = await request(buildApp())
        .get(`/api/trucks/search?${SEARCH_PARAMS}&truck_type=InvalidType`)
        .set(CUSTOMER_HEADERS);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid truck_type');
    });

    it('returns 400 for invalid material_type', async () => {
      const res = await request(buildApp())
        .get(`/api/trucks/search?${SEARCH_PARAMS}&material_type=InvalidMaterial`)
        .set(CUSTOMER_HEADERS);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid material_type');
    });

    it('returns 400 when min_capacity > max_capacity', async () => {
      const res = await request(buildApp())
        .get(`/api/trucks/search?${SEARCH_PARAMS}&min_capacity=20&max_capacity=5`)
        .set(CUSTOMER_HEADERS);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('min_capacity must be less than or equal to max_capacity');
    });

    it('filters by capacity range', async () => {
      mockTelemetryResults = [{ driver_id: 'driver-uuid-456' }];
      m.store.trucks = [
        { id: 'truck-small', name: 'Mini Truck', number_plate: 'MH12AB0001', max_capacity_tons: 3, owner_id: 'driver-uuid-456' },
        { id: 'truck-big', name: 'Container Truck', number_plate: 'MH12AB0002', max_capacity_tons: 15, owner_id: 'driver-uuid-456' },
      ];
      m.store.driver_details = [
        { user_id: 'driver-uuid-456', is_online: true, truck_id: 'truck-small', rating: 4.0, total_trips: 50, completion_rate: 90 },
      ];
      m.store.profiles = [
        { id: 'driver-uuid-456', full_name: 'Ravi Kumar' },
      ];

      const res = await request(buildApp())
        .get(`/api/trucks/search?${SEARCH_PARAMS}&min_capacity=10`)
        .set(CUSTOMER_HEADERS);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(0);
    });

    it('filters by truck_type using name match', async () => {
      seedSearchData();
      const res = await request(buildApp())
        .get(`/api/trucks/search?${SEARCH_PARAMS}&truck_type=Refrigerated`)
        .set(CUSTOMER_HEADERS);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(0);
    });

    it('accepts valid optional filters without errors', async () => {
      seedSearchData();
      const res = await request(buildApp())
        .get(`/api/trucks/search?${SEARCH_PARAMS}&truck_type=Open%20Body&min_capacity=5&max_capacity=20&material_type=Textile`)
        .set(CUSTOMER_HEADERS);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('returns empty when no nearby drivers', async () => {
      mockTelemetryResults = [];
      const res = await request(buildApp())
        .get(`/api/trucks/search?${SEARCH_PARAMS}`)
        .set(CUSTOMER_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('returns 400 for invalid min_capacity value', async () => {
      const res = await request(buildApp())
        .get(`/api/trucks/search?${SEARCH_PARAMS}&min_capacity=abc`)
        .set(CUSTOMER_HEADERS);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('min_capacity');
    });

    it('returns 400 for negative capacity', async () => {
      const res = await request(buildApp())
        .get(`/api/trucks/search?${SEARCH_PARAMS}&min_capacity=-5`)
        .set(CUSTOMER_HEADERS);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('min_capacity');
    });
  });
});
