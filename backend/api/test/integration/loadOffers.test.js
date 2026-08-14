import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

const { createSupabaseMock } = await vi.importActual('../helpers/supabaseMock.js');
const m = createSupabaseMock();

vi.mock('../../src/config/db.js', () => ({
  supabase: m.supabase,
  supabaseAdmin: m.supabase,
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
      expect(filters).toContainEqual({ col: null, op: 'or', val: 'extra_distance_km.is.null,extra_distance_km.lte.15' });
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
      expect(call.filters).toContainEqual({ col: null, op: 'or', val: 'extra_distance_km.is.null,extra_distance_km.lte.15.25' });
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
      expect(call.orders[0]).toEqual({ col: 'freight_value', ascending: true });
      expect(call.orders[1]).toEqual({ col: 'id', ascending: true });

      // Sort by distance -> maps to extra_distance_km
      await request(buildApp())
        .get('/api/loads?sort_by=distance&order=desc')
        .set(DRIVER_HEADERS);

      call = m.calls[m.calls.length - 1];
      expect(call.orders[0]).toEqual({ col: 'extra_distance_km', ascending: false });
      expect(call.orders[1]).toEqual({ col: 'id', ascending: false });
    });

    it('adds an id tie-breaker to the default sort for stable pagination', async () => {
      await request(buildApp())
        .get('/api/loads')
        .set(DRIVER_HEADERS);

      const call = m.calls[m.calls.length - 1];
      expect(call.orders).toEqual([
        { col: 'created_at', ascending: false },
        { col: 'id', ascending: false },
      ]);
    });

    it('keeps pagination stable across re-requests of the same page', async () => {
      // Two loads share the same created_at; only the id tie-breaker can
      // deterministically order them, so the same page must repeat.
      m.store.load_offers.push(
        { id: 'load-a', status: 'available', created_at: '2025-01-01T00:00:00Z', freight_value: 100 },
        { id: 'load-b', status: 'available', created_at: '2025-01-01T00:00:00Z', freight_value: 100 },
        { id: 'load-c', status: 'available', created_at: '2025-01-02T00:00:00Z', freight_value: 100 },
      );

      const first = await request(buildApp()).get('/api/loads?limit=2').set(DRIVER_HEADERS);
      const second = await request(buildApp()).get('/api/loads?limit=2').set(DRIVER_HEADERS);

      expect(first.status).toBe(200);
      expect(first.body.loads).toHaveLength(2);
      expect(second.body.loads.map(l => l.id)).toEqual(first.body.loads.map(l => l.id));
      expect(first.body.total).toBe(3);
    });

    it('returns the correct page of results with the id tie-breaker', async () => {
      m.store.load_offers.push(
        { id: 'load-a', status: 'available', created_at: '2025-01-01T00:00:00Z' },
        { id: 'load-b', status: 'available', created_at: '2025-01-02T00:00:00Z' },
        { id: 'load-c', status: 'available', created_at: '2025-01-03T00:00:00Z' },
        { id: 'load-d', status: 'available', created_at: '2025-01-04T00:00:00Z' },
      );

      // Default sort is created_at DESC, so page 2 of limit=2 is the two oldest.
      const res = await request(buildApp()).get('/api/loads?page=2&limit=2').set(DRIVER_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body.page).toBe(2);
      expect(res.body.total).toBe(4);
      expect(res.body.totalPages).toBe(2);
      expect(res.body.loads.map(l => l.id)).toEqual(['load-b', 'load-a']);
    });

    it('returns empty list with count metadata when nothing matches', async () => {
      m.store.load_offers.push({
        id: 'load-1',
        status: 'available',
        pickup_address: 'Chennai Central',
      });

      const res = await request(buildApp())
        .get('/api/loads?destination=nowhere')
        .set(DRIVER_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body.loads).toHaveLength(0);
      expect(res.body.total).toBe(0);
      expect(res.body.totalPages).toBe(0);
    });

    it('paginates within a filtered status', async () => {
      m.store.load_offers.push(
        { id: 'load-1', status: 'available', created_at: '2025-01-01T00:00:00Z' },
        { id: 'load-2', status: 'available', created_at: '2025-01-02T00:00:00Z' },
        { id: 'load-3', status: 'claimed', created_at: '2025-01-03T00:00:00Z' },
      );

      const res = await request(buildApp())
        .get('/api/loads?status=claimed&limit=1')
        .set(DRIVER_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(res.body.totalPages).toBe(1);
      expect(res.body.loads.map(l => l.id)).toEqual(['load-3']);
    });

    it('keeps NULL extra_distance_km loads when filtering by distance', async () => {
      m.store.load_offers.push(
        { id: 'load-no-dist', status: 'available', extra_distance_km: null },
        { id: 'load-close', status: 'available', extra_distance_km: 5 },
        { id: 'load-far', status: 'available', extra_distance_km: 40 },
      );

      const res = await request(buildApp())
        .get('/api/loads?distance=15')
        .set(DRIVER_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(2);
      expect(res.body.loads.map(l => l.id).sort()).toEqual(['load-close', 'load-no-dist']);
    });

    it('paginates without duplicates or missing records across all pages', async () => {
      const ids = Array.from({ length: 25 }, (_, i) => `load-${String(i).padStart(2, '0')}`);
      m.store.load_offers.push(...ids.map(id => ({ id, status: 'available', created_at: '2025-01-01T00:00:00Z' })));

      const collected = [];
      for (let page = 1; page <= 3; page++) {
        const res = await request(buildApp())
          .get(`/api/loads?page=${page}&limit=10`)
          .set(DRIVER_HEADERS);

        expect(res.status).toBe(200);
        collected.push(...res.body.loads.map(l => l.id));
      }

      expect(collected).toHaveLength(25);
      expect(new Set(collected).size).toBe(25);
      expect(collected.sort()).toEqual(ids);
    });

    it('serves a deep page correctly', async () => {
      const ids = Array.from({ length: 120 }, (_, i) => `load-${String(i).padStart(3, '0')}`);
      m.store.load_offers.push(...ids.map(id => ({ id, status: 'available', created_at: '2025-01-01T00:00:00Z' })));

      const res = await request(buildApp())
        .get('/api/loads?page=12&limit=10')
        .set(DRIVER_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(120);
      expect(res.body.totalPages).toBe(12);
      expect(res.body.loads).toHaveLength(10);
    });

    it('reports an exact count consistent with totalPages metadata', async () => {
      m.store.load_offers.push(
        { id: 'load-1', status: 'available' },
        { id: 'load-2', status: 'available' },
        { id: 'load-3', status: 'claimed' },
      );

      const res = await request(buildApp())
        .get('/api/loads?status=available&limit=2')
        .set(DRIVER_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(2);
      expect(res.body.totalPages).toBe(1);
      expect(res.body.loads).toHaveLength(2);
    });

    it('paginates deterministically through a large dataset', async () => {
      for (let i = 0; i < 250; i++) {
        m.store.load_offers.push({
          id: `load-${String(i).padStart(3, '0')}`,
          status: 'available',
          created_at: i % 5 === 0 ? '2025-01-01T00:00:00Z' : '2025-01-02T00:00:00Z',
        });
      }

      const collected = [];
      for (let page = 1; page <= 25; page++) {
        const res = await request(buildApp())
          .get(`/api/loads?page=${page}&limit=10`)
          .set(DRIVER_HEADERS);

        expect(res.status).toBe(200);
        collected.push(...res.body.loads.map(l => l.id));
      }

      expect(collected).toHaveLength(250);
      expect(new Set(collected).size).toBe(250);
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
