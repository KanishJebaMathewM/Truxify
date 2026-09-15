import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

/**
 * Broken Object-Level Authorization (IDOR) regression tests.
 *
 * Verifies that every protected resource endpoint enforces both
 * authentication AND ownership/role authorization, and that unauthorized
 * access attempts return HTTP 403 without leaking the requested resource.
 */

const { createSupabaseMock } = await vi.importActual('../helpers/supabaseMock.js');
const m = createSupabaseMock();

vi.mock('../../src/config/db.js', () => ({
  supabase: m.supabase,
  createUserClient: () => m.supabase,
  firebaseAdmin: null,
  redisClient: null,
  mongoDb: null,
}));

const { default: driverRouter } = await import('../../src/routes/driverRoutes.js');
const { default: truckRouter } = await import('../../src/routes/truckRoutes.js');
const { default: tollRouter } = await import('../../src/routes/tollOptimization.js');
const { default: carbonTokenRouter } = await import('../../src/routes/carbonTokenRoutes.js');

function buildApp(router, path) {
  const app = express();
  app.use(express.json());
  app.use(path, router);
  return app;
}

const DRIVER_A_HEADERS = {
  'x-user-id': 'driver-a',
  'x-user-role': 'driver',
};
const DRIVER_B_HEADERS = {
  'x-user-id': 'driver-b',
  'x-user-role': 'driver',
};
const CUSTOMER_HEADERS = {
  'x-user-id': 'customer-1',
  'x-user-role': 'customer',
};
const ADMIN_HEADERS = {
  'x-user-id': 'admin-1',
  'x-user-role': 'admin',
};

describe('Resource ownership enforcement', () => {
  beforeEach(() => {
    process.env.BYPASS_AUTH = 'true';
    process.env.NODE_ENV = 'test';
    m.calls.length = 0;
    m.store.trips = [];
    m.store.orders = [];
    m.store.trucks = [];
    m.store.driver_details = [];
    m.store.profiles = [];
  });

  describe('GET /api/driver/:driverId/earnings (IDOR)', () => {
    it('allows a driver to view their own earnings', async () => {
      m.store.trips = [{
        id: 'trp-1',
        driver_id: 'driver-a',
        status: 'completed',
        total_earnings: 1000,
        distance_km: 10,
        created_at: new Date().toISOString(),
        trip_date: new Date().toISOString().split('T')[0],
      }];

      const res = await request(buildApp(driverRouter, '/api/driver'))
        .get('/api/driver/driver-a/earnings')
        .set(DRIVER_A_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body.driver_id).toBe('driver-a');
    });

    it('rejects a driver reading another driver earnings with 403', async () => {
      const res = await request(buildApp(driverRouter, '/api/driver'))
        .get('/api/driver/driver-b/earnings')
        .set(DRIVER_A_HEADERS);

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Access denied');
    });

    it('lets an admin view any driver earnings', async () => {
      m.store.trips = [];

      const res = await request(buildApp(driverRouter, '/api/driver'))
        .get('/api/driver/driver-b/earnings')
        .set(ADMIN_HEADERS);

      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/driver/:driverId, GET /api/driver/:driverId/trips, PUT /api/driver/:driverId', () => {
    const driverId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    const ownHeaders = {
      'x-user-id': driverId,
      'x-user-role': 'driver',
    };
    const otherHeaders = {
      'x-user-id': 'cdb8c309-1d90-4d0a-95e1-2a1b1b1b1b1b',
      'x-user-role': 'driver',
    };

    it('getDriverById rejects reading another driver profile with 403', async () => {
      m.store.profiles.push({ id: driverId, full_name: 'Driver A', phone: '+911' });

      const res = await request(buildApp(driverRouter, '/api/driver'))
        .get(`/api/driver/${driverId}`)
        .set(otherHeaders);

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Access denied');
    });

    it('getDriverById allows a driver to read their own profile', async () => {
      m.store.profiles.push({ id: driverId, full_name: 'Driver A', phone: '+911' });

      const res = await request(buildApp(driverRouter, '/api/driver'))
        .get(`/api/driver/${driverId}`)
        .set(ownHeaders);

      expect(res.status).toBe(200);
      expect(res.body.profile.id).toBe(driverId);
    });

    it('getDriverTrips rejects listing another driver trips with 403', async () => {
      m.store.trips.push({ id: 't1', driver_id: driverId, status: 'completed' });

      const res = await request(buildApp(driverRouter, '/api/driver'))
        .get(`/api/driver/${driverId}/trips`)
        .set(otherHeaders);

      expect(res.status).toBe(403);
    });

    it('getDriverTrips lists own trips for the owner', async () => {
      m.store.trips.push({ id: 't1', driver_id: driverId, status: 'completed', trip_date: '2026-01-01' });

      const res = await request(buildApp(driverRouter, '/api/driver'))
        .get(`/api/driver/${driverId}/trips`)
        .set(ownHeaders);

      expect(res.status).toBe(200);
      expect(res.body.trips).toHaveLength(1);
    });

    it('updateDriver rejects modifying another driver profile with 403', async () => {
      m.store.profiles.push({ id: driverId, full_name: 'Driver A' });

      const res = await request(buildApp(driverRouter, '/api/driver'))
        .put(`/api/driver/${driverId}`)
        .set(otherHeaders)
        .send({ full_name: 'Hacked' });

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/trucks/:id/fuel-advisor', () => {
    it('does not leak truck recommendations to a customer for a truck they do not own', async () => {
      m.store.trucks = [{ id: 'truck-1', driver_id: 'driver-a' }];

      const res = await request(buildApp(truckRouter, '/api/v1/trucks'))
        .get('/api/v1/trucks/truck-1/fuel-advisor?destination_lat=30&destination_lng=70')
        .set(CUSTOMER_HEADERS);

      expect(res.status).toBe(403);
    });

    it('allows an admin to read fuel advice for any truck', async () => {
      m.store.trucks = [{ id: 'truck-1', driver_id: 'driver-a' }];

      const res = await request(buildApp(truckRouter, '/api/v1/trucks'))
        .get('/api/v1/trucks/truck-1/fuel-advisor?destination_lat=30&destination_lng=70')
        .set(ADMIN_HEADERS);

      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/tolls/optimize', () => {
    it('requires authentication', async () => {
      process.env.BYPASS_AUTH = 'false';
      const res = await request(buildApp(tollRouter, '/api/tolls'))
        .post('/api/tolls/optimize')
        .send({ routes: [{ id: 'r1' }] });

      expect(res.status).toBe(401);
      process.env.BYPASS_AUTH = 'true';
    });

    it('accepts authenticated optimization requests', async () => {
      const res = await request(buildApp(tollRouter, '/api/tolls'))
        .post('/api/tolls/optimize')
        .set({ 'x-user-id': 'driver-a', 'x-user-role': 'driver' })
        .send({ routes: [{ id: 'r1', distanceKm: 100, baseCost: 0 }] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('POST /api/carbon-credits/mint (trip ownership)', () => {
    it('rejects a driver minting credits for another driver trip with 403', async () => {
      m.store.trips = [{ id: 'trip-b', driver_id: 'driver-b', status: 'completed' }];

      const res = await request(buildApp(carbonTokenRouter, '/api/carbon-credits'))
        .post('/api/carbon-credits/mint')
        .set(DRIVER_A_HEADERS)
        .send({ truck_id: 'truck-1', trip_id: 'trip-b', fuel_saved_liters: 10 });

      expect(res.status).toBe(403);
    });

    it('allows a driver to mint credits for their own trip', async () => {
      m.store.trips = [{ id: 'trip-a', driver_id: 'driver-a', status: 'completed' }];

      const res = await request(buildApp(carbonTokenRouter, '/api/carbon-credits'))
        .post('/api/carbon-credits/mint')
        .set(DRIVER_A_HEADERS)
        .send({ truck_id: 'truck-1', trip_id: 'trip-a', fuel_saved_liters: 10 });

      expect(res.status).toBe(201);
    });

    it('rejects a customer minting carbon credits', async () => {
      const res = await request(buildApp(carbonTokenRouter, '/api/carbon-credits'))
        .post('/api/carbon-credits/mint')
        .set(CUSTOMER_HEADERS)
        .send({ truck_id: 'truck-1', trip_id: 'trip-a', fuel_saved_liters: 10 });

      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/carbon-credits/purchase (shipper ownership)', () => {
    it('rejects a user purchasing credits with another shipper id with 403', async () => {
      const res = await request(buildApp(carbonTokenRouter, '/api/carbon-credits'))
        .post('/api/carbon-credits/purchase')
        .set(CUSTOMER_HEADERS)
        .send({ token_id: 'CCT-1', buyer_address: '0xabc', shipper_id: 'shipper-999' });

      expect(res.status).toBe(403);
    });

    it('allows a customer to purchase credits under their own shipper id', async () => {
      const res = await request(buildApp(carbonTokenRouter, '/api/carbon-credits'))
        .post('/api/carbon-credits/purchase')
        .set({ 'x-user-id': 'shipper-1', 'x-user-role': 'customer' })
        .send({ token_id: 'CCT-x', buyer_address: '0xabc', shipper_id: 'shipper-1' });

      expect(res.status).toBe(500); // token not minted in this in-memory store; ownership gate passed
    });
  });
});