import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import truckRoutes from '../../src/routes/truckRoutes.js';

let app;

const mockDrivers = [
  { user_id: 'drv-1', rating: 4.8, total_trips: 45, completion_rate: 98, truck_id: 'trk-1', is_online: true },
  { user_id: 'drv-2', rating: 4.5, total_trips: 20, completion_rate: 95, truck_id: 'trk-2', is_online: true },
  { user_id: 'drv-3', rating: 4.9, total_trips: 100, completion_rate: 99, truck_id: 'trk-3', is_online: true },
];

const mockTrucks = [
  { id: 'trk-1', name: 'Refrigerated Cold Express', truck_type: 'Refrigerated', number_plate: 'MH-12-AB-1234', max_capacity_tons: 15, supported_cargo_types: ['Perishable', 'Food', 'General'] },
  { id: 'trk-2', name: 'Heavy Hazmat Tanker', truck_type: 'Tanker', number_plate: 'MH-14-CD-5678', max_capacity_tons: 25, supported_cargo_types: ['Hazardous', 'Liquid'] },
  { id: 'trk-3', name: 'Container Cargo Express', truck_type: 'Container', number_plate: 'DL-01-EF-9012', max_capacity_tons: 10, supported_cargo_types: ['General', 'Fragile', 'Electronics'] },
];

const mockProfiles = [
  { id: 'drv-1', full_name: 'Rajesh Kumar', avatar_url: null, is_digilocker_verified: true },
  { id: 'drv-2', full_name: 'Suresh Patil', avatar_url: null, is_digilocker_verified: true },
  { id: 'drv-3', full_name: 'Vikram Singh', avatar_url: null, is_digilocker_verified: false },
];

vi.mock('../../src/config/db.js', () => {
  const supabaseMock = {
      from: (table) => {
        if (table === 'driver_details') {
          return {
            select: () => ({
              eq: () => ({
                not: () => ({
                  in: () => Promise.resolve({ data: mockDrivers, error: null }),
                }),
              }),
            }),
          };
        }
        if (table === 'trucks') {
          return {
            select: () => ({
              in: (field, ids) => {
                const filtered = mockTrucks.filter(t => ids.includes(t.id));
                return Promise.resolve({ data: filtered, error: null });
              },
            }),
          };
        }
        if (table === 'profiles') {
          return {
            select: () => ({
              in: (field, ids) => {
                const filtered = mockProfiles.filter(p => ids.includes(p.id));
                return Promise.resolve({ data: filtered, error: null });
              },
            }),
          };
        }
        // Unknown tables get a deep chainable empty stub (the handler queries
        // more tables than the three named above — e.g. the access check).
        const chain = {
          select: () => chain,
          eq: () => chain,
          not: () => chain,
          in: () => chain,
          gte: () => chain,
          lte: () => chain,
          order: () => chain,
          limit: () => chain,
          or: () => chain,
          single: () => Promise.resolve({ data: null, error: null }),
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
          then: (resolve) => Promise.resolve({ data: [], error: null }).then(resolve),
        };
        return chain;
      },
  };
  const mongoDb = {
    collection: () => ({
      // The handler chains .find().limit(200).toArray()
      find: () => ({
        limit: () => ({
          toArray: () => Promise.resolve([
            { driver_id: 'drv-1' },
            { driver_id: 'drv-2' },
            { driver_id: 'drv-3' },
          ]),
        }),
      }),
    }),
  };
  const redisClient = {
      get: () => Promise.resolve(null),
      set: () => Promise.resolve('OK'),
      del: () => Promise.resolve(1),
      call: (cmd) => {
        if (cmd === 'script' || cmd === 'SCRIPT') return Promise.resolve('sha-mock-12345');
        if (cmd === 'eval' || cmd === 'evalsha' || cmd === 'EVAL' || cmd === 'EVALSHA') return Promise.resolve([1, 60000]);
        return Promise.resolve(1);
      },
      status: 'ready',
  };
  const upstashRedisClient = {
      get: () => Promise.resolve(null),
      set: () => Promise.resolve('OK'),
      del: () => Promise.resolve(1),
      call: (cmd) => {
        if (cmd === 'script' || cmd === 'SCRIPT') return Promise.resolve('sha-mock-12345');
        if (cmd === 'eval' || cmd === 'evalsha' || cmd === 'EVAL' || cmd === 'EVALSHA') return Promise.resolve([1, 60000]);
        return Promise.resolve(1);
      },
      status: 'ready',
  };
  return {
    supabase: supabaseMock,
    // The search handler reads via the service-role client.
    supabaseAdmin: supabaseMock,
    createUserClient: () => supabaseMock,
    mongoDb,
    redisClient,
    upstashRedisClient,
    firebaseAdmin: null,
  };
});

describe('Find Trucks Search Filter by Truck Type & Cargo Category', () => {
  beforeEach(async () => {
    process.env.BYPASS_AUTH = 'true';
    process.env.NODE_ENV = 'test';
    app = express();
    app.use(express.json());
    app.use('/api/trucks', truckRoutes);
  });

  it('should search trucks without filters and return all available trucks (no regression)', async () => {
    const res = await request(app)
      .get('/api/trucks/search')
      .set('x-dev-access-token', 'test-access-token')
      .set('x-user-id', 'test-user-1')
      .set('x-user-role', 'customer')
      .query({
        pickup_lat: 19.0760,
        pickup_lng: 72.8777,
        drop_lat: 28.7041,
        drop_lng: 77.1025,
        weight_tonnes: 5,
      });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(3);
  });

  it('should filter trucks by multi-select truck_types parameter', async () => {
    const res = await request(app)
      .get('/api/trucks/search')
      .set('x-dev-access-token', 'test-access-token')
      .set('x-user-id', 'test-user-1')
      .set('x-user-role', 'customer')
      .query({
        pickup_lat: 19.0760,
        pickup_lng: 72.8777,
        drop_lat: 28.7041,
        drop_lng: 77.1025,
        weight_tonnes: 5,
        truck_types: 'Refrigerated,Container',
      });

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
    const truckTypes = res.body.map(t => t.truckType);
    expect(truckTypes).toContain('Refrigerated');
    expect(truckTypes).toContain('Container');
    expect(truckTypes).not.toContain('Tanker');
  });

  it('should filter trucks by multi-select cargo_categories parameter', async () => {
    const res = await request(app)
      .get('/api/trucks/search')
      .set('x-dev-access-token', 'test-access-token')
      .set('x-user-id', 'test-user-1')
      .set('x-user-role', 'customer')
      .query({
        pickup_lat: 19.0760,
        pickup_lng: 72.8777,
        drop_lat: 28.7041,
        drop_lng: 77.1025,
        weight_tonnes: 5,
        cargo_categories: 'Hazardous',
      });

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].truckType).toBe('Tanker');
    expect(res.body[0].driver).toBe('Suresh Patil');
  });

  it('should filter trucks by combined truck_types and cargo_categories parameters', async () => {
    const res = await request(app)
      .get('/api/trucks/search')
      .set('x-dev-access-token', 'test-access-token')
      .set('x-user-id', 'test-user-1')
      .set('x-user-role', 'customer')
      .query({
        pickup_lat: 19.0760,
        pickup_lng: 72.8777,
        drop_lat: 28.7041,
        drop_lng: 77.1025,
        weight_tonnes: 5,
        truck_types: 'Refrigerated',
        cargo_categories: 'Perishable',
      });

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].truckType).toBe('Refrigerated');
    expect(res.body[0].driver).toBe('Rajesh Kumar');
  });
});
