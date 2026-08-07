/**
 * Unit tests for backend/api/src/routes/iotRoutes.js
 *
 * The router was previously never mounted (all /api/iot/* endpoints 404) and
 * its authorization reads used the anon-key supabase client, which RLS hides
 * from (load_offers / orders are anon-revoked). These tests mount the router
 * with mocked auth/rate-limiters and assert the write + read paths work and
 * that every database access goes through the service-role client.
 *
 * Run with:  npm test -- test/unit/iotRoutes.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import iotRoutes from '../../src/routes/iotRoutes.js';

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => next(),
}));

vi.mock('express-rate-limit', () => ({
  default: () => (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  safeIpKeyGenerator: () => 'test-ip',
  createStore: vi.fn(() => ({})),
}));

const { anonFrom } = vi.hoisted(() => ({
  anonFrom: vi.fn(() => {
    throw new Error('anon supabase must never be used by iotRoutes');
  }),
}));

vi.mock('../../src/config/db.js', () => ({
  supabase: { from: anonFrom },
  supabaseAdmin: { from: vi.fn() },
}));

import { supabaseAdmin } from '../../src/config/db.js';

const adminFrom = supabaseAdmin.from;

function maybeSingleChain(result) {
  return {
    select: vi.fn(() => maybeSingleChain(result)),
    eq: vi.fn(() => maybeSingleChain(result)),
    in: vi.fn(() => maybeSingleChain(result)),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
  };
}

function insertStub(error = null) {
  return {
    insert: vi.fn(async () => ({ data: null, error })),
  };
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/iot', (req, _res, next) => {
    req.user = {
      id: req.headers['x-user-id'],
      role: req.headers['x-user-role'] || 'customer',
    };
    next();
  });
  app.use('/api/iot', iotRoutes);
  return app;
}

describe('iotRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('POST /api/iot/telemetry/:id records telemetry for the owning customer using the service-role client', async () => {
    const load = { requires_refrigeration: true, target_temperature_min: 0, target_temperature_max: 10, customer_id: 'cust-1' };
    adminFrom.mockImplementation((table) => {
      if (table === 'load_offers') return maybeSingleChain({ data: load, error: null });
      if (table === 'temperature_telemetry') return insertStub();
      throw new Error(`Unexpected table ${table}`);
    });

    const res = await request(buildApp())
      .post('/api/iot/telemetry/load-1')
      .set('x-user-id', 'cust-1')
      .send({ temperature: 5 });

    expect(res.status).toBe(201);
    expect(adminFrom).toHaveBeenCalledWith('load_offers');
    expect(adminFrom).toHaveBeenCalledWith('temperature_telemetry');
    expect(anonFrom).not.toHaveBeenCalled();
  });

  it('POST /api/iot/telemetry/:id returns 403 for a non-owning non-admin user', async () => {
    const load = { requires_refrigeration: true, target_temperature_min: 0, target_temperature_max: 10, customer_id: 'cust-1' };
    adminFrom.mockImplementation((table) => {
      if (table === 'load_offers') return maybeSingleChain({ data: load, error: null });
      throw new Error(`Unexpected table ${table}`);
    });

    const res = await request(buildApp())
      .post('/api/iot/telemetry/load-1')
      .set('x-user-id', 'other-user')
      .send({ temperature: 5 });

    expect(res.status).toBe(403);
  });

  it('POST /api/iot/telemetry/:id returns 404 when the load does not exist', async () => {
    adminFrom.mockImplementation((table) => {
      if (table === 'load_offers') return maybeSingleChain({ data: null, error: null });
      throw new Error(`Unexpected table ${table}`);
    });

    const res = await request(buildApp())
      .post('/api/iot/telemetry/load-1')
      .set('x-user-id', 'cust-1')
      .send({ temperature: 5 });

    expect(res.status).toBe(404);
  });

  it('GET /api/iot/telemetry/:id returns telemetry history for the owning customer', async () => {
    const load = { customer_id: 'cust-1', order_display_id: 'OD-1' };
    const telemetry = [{ load_id: 'load-1', temperature: 5 }];
    adminFrom.mockImplementation((table) => {
      if (table === 'load_offers') return maybeSingleChain({ data: load, error: null });
      if (table === 'temperature_telemetry') {
        const chain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          order: vi.fn(() => chain),
          limit: vi.fn(() => chain),
          then(resolve) { return Promise.resolve(resolve({ data: telemetry, error: null })); },
        };
        return chain;
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const res = await request(buildApp())
      .get('/api/iot/telemetry/load-1')
      .set('x-user-id', 'cust-1');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(telemetry);
    expect(adminFrom).toHaveBeenCalledWith('temperature_telemetry');
    expect(anonFrom).not.toHaveBeenCalled();
  });

  it('GET /api/iot/telemetry/:id allows the assigned driver via the orders lookup', async () => {
    const load = { customer_id: 'cust-1', order_display_id: 'OD-1' };
    const telemetry = [{ load_id: 'load-1', temperature: 5 }];
    adminFrom.mockImplementation((table) => {
      if (table === 'load_offers') return maybeSingleChain({ data: load, error: null });
      if (table === 'orders') return maybeSingleChain({ data: { driver_id: 'driver-1' }, error: null });
      if (table === 'temperature_telemetry') {
        const chain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          order: vi.fn(() => chain),
          limit: vi.fn(() => chain),
          then(resolve) { return Promise.resolve(resolve({ data: telemetry, error: null })); },
        };
        return chain;
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const res = await request(buildApp())
      .get('/api/iot/telemetry/load-1')
      .set('x-user-id', 'driver-1');

    expect(res.status).toBe(200);
    expect(adminFrom).toHaveBeenCalledWith('orders');
    expect(anonFrom).not.toHaveBeenCalled();
  });
});
