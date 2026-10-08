import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockTrips = [
  {
    id: 'trp-101',
    trip_display_id: 'TRP-101',
    driver_id: 'test-driver-1',
    status: 'completed',
    total_earnings: 500000, // 5000 INR in paisa
    distance_km: 100,
    created_at: new Date().toISOString(),
    trip_date: new Date().toISOString().split('T')[0],
    pickup_address: 'Bhiwandi Warehouses, MH',
    drop_address: 'Vashi APMC Market, Navi Mumbai',
  },
  {
    id: 'trp-102',
    trip_display_id: 'TRP-102',
    driver_id: 'test-driver-1',
    status: 'completed',
    total_earnings: 300000, // 3000 INR in paisa
    distance_km: 60,
    created_at: new Date(Date.now() - 86400000).toISOString(),
    trip_date: new Date(Date.now() - 86400000).toISOString().split('T')[0],
    pickup_address: 'JNPT Port, Navi Mumbai',
    drop_address: 'Chakan MIDC, Pune',
  },
  {
    id: 'trp-103',
    trip_display_id: 'TRP-103',
    driver_id: 'test-driver-1',
    status: 'locked',
    total_earnings: 400000, // 4000 INR locked in escrow
    distance_km: 80,
    created_at: new Date().toISOString(),
    trip_date: new Date().toISOString().split('T')[0],
    pickup_address: 'Thane West, Thane',
    drop_address: 'Panvel, Navi Mumbai',
  },
];

vi.mock('../../src/config/db.js', () => {
  return {
    supabase: {
      from: (table) => {
        if (table === 'trips') {
          return {
            select: () => ({
              eq: (field, val) => ({
                gte: () => ({
                  order: () => Promise.resolve({ data: mockTrips.filter(t => t.driver_id === val), error: null }),
                }),
              }),
            }),
          };
        }
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: [], error: null }),
          }),
        };
      },
    },
    mongoDb: null,
    redisClient: {
      get: () => Promise.resolve(null),
      set: () => Promise.resolve('OK'),
      del: () => Promise.resolve(1),
      call: (cmd) => {
        if (cmd === 'script' || cmd === 'SCRIPT') return Promise.resolve('sha-mock-12345');
        if (cmd === 'eval' || cmd === 'evalsha' || cmd === 'EVAL' || cmd === 'EVALSHA') return Promise.resolve([1, 60000]);
        return Promise.resolve(1);
      },
      status: 'ready',
    },
    upstashRedisClient: null,
    supabaseAdmin: null,
    firebaseAdmin: null,
  };
});

import driverRoutes from '../../src/routes/driverRoutes.js';

let app;

describe('Driver Earnings API Endpoint Suite', () => {
  beforeEach(async () => {
    process.env.BYPASS_AUTH = 'true';
    process.env.NODE_ENV = 'test';
    app = express();
    app.use(express.json());
    app.use('/api/driver', driverRoutes);
  });

  it('should return aggregated earnings for period=today', async () => {
    const res = await request(app)
      .get('/api/driver/earnings')
      .set('x-dev-access-token', 'test-access-token')
      .set('x-user-id', 'test-driver-1')
      .set('x-user-role', 'driver')
      .query({ period: 'today' });

    expect(res.status).toBe(200);
    expect(res.body.period).toBe('today');
    expect(res.body.gross_earnings).toBeGreaterThan(0);
    expect(res.body.net_earnings).toBeGreaterThan(0);
    expect(Array.isArray(res.body.completed_trips)).toBe(true);
  });

  it('should return 7-day trend chart and breakdown for period=week', async () => {
    const res = await request(app)
      .get('/api/driver/earnings')
      .set('x-dev-access-token', 'test-access-token')
      .set('x-user-id', 'test-driver-1')
      .set('x-user-role', 'driver')
      .query({ period: 'week' });

    expect(res.status).toBe(200);
    expect(res.body.period).toBe('week');
    expect(Array.isArray(res.body.trend_chart)).toBe(true);
    expect(res.body.trend_chart.length).toBe(7);
  });

  it('should return monthly earnings breakdown for period=month', async () => {
    const res = await request(app)
      .get('/api/driver/earnings')
      .set('x-dev-access-token', 'test-access-token')
      .set('x-user-id', 'test-driver-1')
      .set('x-user-role', 'driver')
      .query({ period: 'month' });

    expect(res.status).toBe(200);
    expect(res.body.period).toBe('month');
    expect(res.body.trip_count).toBeGreaterThanOrEqual(1);
  });

  it('should include pending locked smart contract escrow payments', async () => {
    const res = await request(app)
      .get('/api/driver/earnings')
      .set('x-dev-access-token', 'test-access-token')
      .set('x-user-id', 'test-driver-1')
      .set('x-user-role', 'driver')
      .query({ period: 'week' });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.pending_payments)).toBe(true);
    expect(res.body.pending_payments.length).toBe(1);
    expect(res.body.pending_payments[0].status).toBe('locked');
  });

  it('should forbid a driver from viewing another driver earnings via the parameterized route', async () => {
    const res = await request(app)
      .get('/api/driver/other-driver-999/earnings')
      .set('x-dev-access-token', 'test-access-token')
      .set('x-user-id', 'test-driver-1')
      .set('x-user-role', 'driver')
      .query({ period: 'week' });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain('You can only view your own earnings');
  });

  it('should allow a driver to view their own earnings via the parameterized route', async () => {
    const res = await request(app)
      .get('/api/driver/test-driver-1/earnings')
      .set('x-dev-access-token', 'test-access-token')
      .set('x-user-id', 'test-driver-1')
      .set('x-user-role', 'driver')
      .query({ period: 'week' });

    expect(res.status).toBe(200);
    expect(res.body.period).toBe('week');
    expect(Array.isArray(res.body.completed_trips)).toBe(true);
  });

  it('should allow an admin to view any driver earnings', async () => {
    const res = await request(app)
      .get('/api/driver/other-driver-999/earnings')
      .set('x-dev-access-token', 'test-access-token')
      .set('x-user-id', 'test-admin-1')
      .set('x-user-role', 'admin')
      .query({ period: 'week' });

    expect(res.status).toBe(200);
  });
});
