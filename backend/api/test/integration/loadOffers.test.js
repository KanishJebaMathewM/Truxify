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

const { default: loadRouter } = await import('../../src/routes/loadRoutes.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/loads', loadRouter);
  return app;
}

const DRIVER_HEADERS = {
  'x-user-id': 'driver-uuid-123',
  'x-user-role': 'driver',
  'x-user-name': 'Test Driver',
};

const CUSTOMER_HEADERS = {
  'x-user-id': 'customer-uuid-123',
  'x-user-role': 'customer',
  'x-user-name': 'Test Customer',
};

describe('Load Offers Routes Integration Tests', () => {
  beforeEach(() => {
    process.env.BYPASS_AUTH = 'true';
    process.env.NODE_ENV = 'test';
    m.store.load_offers = [];
    m.calls.length = 0;
  });

  describe('GET /api/loads (Browse Loads)', () => {
    it('returns 401 if x-user-id header is missing when BYPASS_AUTH is enabled', async () => {
      const res = await request(buildApp())
        .get('/api/loads');

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Authentication bypassed but x-user-id header is missing.');
    });

    it('returns 403 if user role is not authorized (driver only)', async () => {
      const res = await request(buildApp())
        .get('/api/loads')
        .set(CUSTOMER_HEADERS);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Forbidden: Insufficient privileges.');
    });

    it('successfully fetches available load offers with default pagination', async () => {
      // Pre-load dummy data in available status
      m.store.load_offers.push({
        id: 'load-1',
        pickup_address: 'Chennai Central',
        drop_address: 'Bangalore City',
        freight_value: 1200000, // 12000 INR
        extra_distance_km: 10,
        status: 'available',
        goods_type: 'Industrial'
      });

      const res = await request(buildApp())
        .get('/api/loads')
        .set(DRIVER_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body.loads).toHaveLength(1);
      expect(res.body.total).toBe(1);
      expect(res.body.page).toBe(1);
      expect(res.body.limit).toBe(10);
      
      const load = res.body.loads[0];
      expect(load.id).toBe('load-1');
      expect(load.pickup).toBe('Chennai Central');
      expect(load.destination).toBe('Bangalore City');
      expect(load.estimated_price).toBe(12000);
      expect(load.vehicle_type).toBe('Truck');
    });

    it('rejects invalid pagination parameters', async () => {
      // Test letters/malformed strings
      let res = await request(buildApp())
        .get('/api/loads?page=2abc')
        .set(DRIVER_HEADERS);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('page must be a valid integer');

      res = await request(buildApp())
        .get('/api/loads?limit=10.7')
        .set(DRIVER_HEADERS);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('limit must be a valid integer');

      // Test out of range values
      res = await request(buildApp())
        .get('/api/loads?page=0')
        .set(DRIVER_HEADERS);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('page must be greater than or equal to 1');

      res = await request(buildApp())
        .get('/api/loads?limit=101')
        .set(DRIVER_HEADERS);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('limit must be between 1 and 100');
    });

    it('applies filters correctly', async () => {
      m.store.load_offers.push({
        id: 'load-1',
        pickup_address: 'Chennai Central',
        drop_address: 'Bangalore City',
        freight_value: 1200000,
        extra_distance_km: 10,
        status: 'available',
        goods_type: 'Industrial'
      });

      const res = await request(buildApp())
        .get('/api/loads?pickup_location=Chennai&destination=Bangalore&goods_type=Industrial&min_price=10000&max_price=15000&distance=15')
        .set(DRIVER_HEADERS);

      expect(res.status).toBe(200);

      // Verify DB queries made
      const call = m.calls.find(c => c.table === 'load_offers' && c.mode === 'select');
      expect(call).toBeDefined();
      
      const filters = call.filters;
      expect(filters).toContainEqual({ col: 'pickup_address', op: 'ilike', val: '%Chennai%' });
      expect(filters).toContainEqual({ col: 'drop_address', op: 'ilike', val: '%Bangalore%' });
      expect(filters).toContainEqual({ col: 'goods_type', op: 'eq', val: 'Industrial' });
      expect(filters).toContainEqual({ col: 'freight_value', op: 'gte', val: 1000000 });
      expect(filters).toContainEqual({ col: 'freight_value', op: 'lte', val: 1500000 });
      expect(filters).toContainEqual({ col: 'extra_distance_km', op: 'lte', val: 15 });
    });

    it.each([
      ['min_price', '100abc'],
      ['max_price', '500rupees'],
      ['distance', '25km'],
      ['min_price', 'Infinity'],
      ['max_price', '1e3'],
      ['distance', '-1'],
      ['distance', ''],
    ])('rejects malformed %s filter value %s', async (field, value) => {
      const res = await request(buildApp())
        .get(`/api/loads?${field}=${encodeURIComponent(value)}`)
        .set(DRIVER_HEADERS);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
      expect(res.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field }),
        ])
      );
      expect(m.calls.find(call => call.table === 'load_offers')).toBeUndefined();
    });

    it('escapes LIKE metacharacters in pickup_location to prevent injection', async () => {
      m.store.load_offers.push({
        id: 'load-1',
        pickup_address: 'Chennai Central',
        drop_address: 'Bangalore City',
        status: 'available',
      });

      const res = await request(buildApp())
        .get(`/api/loads?pickup_location=${encodeURIComponent('%')}`)
        .set(DRIVER_HEADERS);

      expect(res.status).toBe(200);

      const call = m.calls.find(c => c.table === 'load_offers' && c.mode === 'select');
      const pickupFilter = call.filters.find(f => f.col === 'pickup_address');
      expect(pickupFilter.val).toBe('%\\%%');
    });

    it('escapes LIKE underscore in pickup_location', async () => {
      m.store.load_offers.push({
        id: 'load-1',
        pickup_address: 'Chennai Central',
        status: 'available',
      });

      const res = await request(buildApp())
        .get(`/api/loads?pickup_location=${encodeURIComponent('_')}`)
        .set(DRIVER_HEADERS);

      expect(res.status).toBe(200);

      const call = m.calls.find(c => c.table === 'load_offers' && c.mode === 'select');
      const pickupFilter = call.filters.find(f => f.col === 'pickup_address');
      expect(pickupFilter.val).toBe('%\\_%');
    });

    it('rejects pickup_location longer than 200 characters', async () => {
      const longString = 'A'.repeat(201);
      const res = await request(buildApp())
        .get(`/api/loads?pickup_location=${longString}`)
        .set(DRIVER_HEADERS);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('pickup_location too long (max 200 chars)');
    });

    it('rejects destination longer than 200 characters', async () => {
      const longString = 'B'.repeat(201);
      const res = await request(buildApp())
        .get(`/api/loads?destination=${longString}`)
        .set(DRIVER_HEADERS);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('destination too long (max 200 chars)');
    });

    it('rejects repeated numeric filters instead of accepting an array', async () => {
      const res = await request(buildApp())
        .get('/api/loads?min_price=100&min_price=200')
        .set(DRIVER_HEADERS);

      expect(res.status).toBe(400);
      expect(res.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'min_price' }),
        ])
      );
    });

    it('rejects a minimum price greater than the maximum price', async () => {
      const res = await request(buildApp())
        .get('/api/loads?min_price=15000&max_price=10000')
        .set(DRIVER_HEADERS);

      expect(res.status).toBe(400);
      expect(res.body.details).toContainEqual({
        field: 'min_price',
        message: 'min_price must be less than or equal to max_price',
      });
      expect(m.calls.find(call => call.table === 'load_offers')).toBeUndefined();
    });

    it('accepts complete decimal strings including zero', async () => {
      const res = await request(buildApp())
        .get('/api/loads?min_price=0&max_price=15000.50&distance=15.25')
        .set(DRIVER_HEADERS);

      expect(res.status).toBe(200);
      const call = m.calls.find(c => c.table === 'load_offers' && c.mode === 'select');
      expect(call.filters).toContainEqual({ col: 'freight_value', op: 'gte', val: 0 });
      expect(call.filters).toContainEqual({ col: 'freight_value', op: 'lte', val: 1500050 });
      expect(call.filters).toContainEqual({ col: 'extra_distance_km', op: 'lte', val: 15.25 });
    });

    it('supports status filtering (open/available maps to available)', async () => {
      m.store.load_offers.push({
        id: 'load-1',
        status: 'available',
      });

      const res = await request(buildApp())
        .get('/api/loads?status=open')
        .set(DRIVER_HEADERS);

      expect(res.status).toBe(200);
      const call = m.calls.find(c => c.table === 'load_offers' && c.mode === 'select');
      expect(call.filters).toContainEqual({ col: 'status', op: 'eq', val: 'available' });
    });

    it('returns empty if vehicle_type filter is not Truck', async () => {
      m.store.load_offers.push({
        id: 'load-1',
        status: 'available',
      });

      const res = await request(buildApp())
        .get('/api/loads?vehicle_type=Van')
        .set(DRIVER_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body.loads).toHaveLength(0);
      expect(res.body.total).toBe(0);
    });

    it('accepts truck vehicle_type filter case-insensitively', async () => {
      m.store.load_offers.push({
        id: 'load-1',
        status: 'available',
      });

      const res = await request(buildApp())
        .get('/api/loads?vehicle_type=truck')
        .set(DRIVER_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body.loads).toHaveLength(1);
      expect(res.body.loads[0].vehicle_type).toBe('Truck');
    });

    it('rejects repeated vehicle_type filters instead of treating them as an array', async () => {
      const res = await request(buildApp())
        .get('/api/loads?vehicle_type=Truck&vehicle_type=Van')
        .set(DRIVER_HEADERS);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('vehicle_type must be a single string');
      expect(m.calls.find(call => call.table === 'load_offers')).toBeUndefined();
    });

    it('maps sort_by parameters correctly', async () => {
      // Sort by estimated_price -> maps to freight_value
      await request(buildApp())
        .get('/api/loads?sort_by=estimated_price&order=asc')
        .set(DRIVER_HEADERS);

      let call = m.calls[m.calls.length - 1];
      expect(call.order).toEqual({ col: 'freight_value', ascending: true });

      // Sort by distance -> maps to extra_distance_km
      await request(buildApp())
        .get('/api/loads?sort_by=distance&order=desc')
        .set(DRIVER_HEADERS);

      call = m.calls[m.calls.length - 1];
      expect(call.order).toEqual({ col: 'extra_distance_km', ascending: false });
    });

    it('rejects unsupported order values', async () => {
      const res = await request(buildApp())
        .get('/api/loads?order=ascending')
        .set(DRIVER_HEADERS);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
      expect(res.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'order' }),
        ])
      );
      expect(m.calls.find(call => call.table === 'load_offers')).toBeUndefined();
    });

    it('rejects unsupported sort_by values', async () => {
      const res = await request(buildApp())
        .get('/api/loads?sort_by=freight_valuee')
        .set(DRIVER_HEADERS);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
      expect(res.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'sort_by' }),
        ])
      );
      expect(m.calls.find(call => call.table === 'load_offers')).toBeUndefined();
    });

    it('returns 500 without leaking database details on db error', async () => {
      m.programError('Internal DB deadlock');

      const res = await request(buildApp())
        .get('/api/loads')
        .set(DRIVER_HEADERS);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to fetch load offers.');
      expect(res.body.details).toBeUndefined();
    });
  });

  describe('GET /api/loads/:id (Get Single Load)', () => {
    it('successfully gets a single available load', async () => {
      m.store.load_offers.push({
        id: 'load-123',
        pickup_address: 'Pune',
        drop_address: 'Mumbai',
        freight_value: 500000,
        status: 'available',
      });

      const res = await request(buildApp())
        .get('/api/loads/load-123')
        .set(DRIVER_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body.load.id).toBe('load-123');
      expect(res.body.load.pickup).toBe('Pune');
      expect(res.body.load.destination).toBe('Mumbai');
      expect(res.body.load.estimated_price).toBe(5000);
    });

    it('returns 404 if load not found or status is not available', async () => {
      m.store.load_offers.push({
        id: 'load-claimed',
        status: 'claimed',
      });

      const res = await request(buildApp())
        .get('/api/loads/load-claimed')
        .set(DRIVER_HEADERS);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Load offer not found or no longer available.');
    });

    it('returns 500 on db error without exposing details', async () => {
      m.programError('Fatal PostgreSQL failure');

      const res = await request(buildApp())
        .get('/api/loads/some-id')
        .set(DRIVER_HEADERS);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to fetch load offer.');
      expect(res.body.details).toBeUndefined();
    });
  });
});
