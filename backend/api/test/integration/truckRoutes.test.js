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
    m.calls.length = 0;
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
  });
});
