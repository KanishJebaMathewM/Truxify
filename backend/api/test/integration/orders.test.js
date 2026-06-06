/**
 * Integration tests for backend/api/src/routes/orderRoutes.js
 *
 * Locks in the server-side pricing contract landed in PR #299:
 *   - Client-supplied monetary fields are IGNORED, server-computed values
 *     are persisted in both `orders` and `load_offers`.
 *   - The camelCase / snake_case key mapping (commit b04413e) is preserved
 *     — no destructure of `pricing` into snake_case locals.
 *   - Invalid coordinates / weight return 400 with a clear pricing error.
 *
 * The test app uses BYPASS_AUTH=true to skip Firebase; the `authenticate`
 * middleware reads the `x-user-id` and `x-user-role` headers directly.
 *
 * Run with:  npm test -- test/integration/orders.test.js
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

const routeEstimateMock = vi.fn();

// Hoisted mock: swap supabase out for our in-memory builder.
const { createSupabaseMock } = await vi.importActual('../helpers/supabaseMock.js');

const m = createSupabaseMock();

vi.mock('../../src/config/db.js', () => ({
  supabase: m.supabase,
  // export the rest as undefined so the route imports are safe
  firebaseAdmin: null,
  redisClient: null,
  mongoDb: null,
}));

vi.mock('../../src/sockets/tracker.js', () => ({
  initWebSocketServer: () => ({}),
}));

vi.mock('../../src/services/osrm.js', () => ({
  getRouteEstimate: routeEstimateMock,
}));

const { default: orderRouter } = await import('../../src/routes/orderRoutes.js');
const { computeOrderPricing } = await import('../../src/lib/pricing.js');
import express from 'express';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/orders', orderRouter);
  return app;
}

const CUSTOMER_HEADERS = {
  'x-user-id': '00000000-0000-0000-0000-000000000abc',
  'x-user-role': 'customer',
  'x-user-name': 'Test Customer',
};

const DRIVER_HEADERS = {
  'x-user-id': '00000000-0000-0000-0000-000000000def',
  'x-user-role': 'driver',
  'x-user-name': 'Test Driver',
};

const validOrderBody = {
  pickup_address: '123 Pickup St, Mumbai',
  pickup_lat: 19.0760,
  pickup_lng: 72.8777,
  drop_address: '456 Drop Ave, Delhi',
  drop_lat: 28.7041,
  drop_lng: 77.1025,
  pickup_date: '2026-06-10',
  pickup_time: '09:00',
  goods_type: 'electronics',
  weight_tonnes: 10,
  length_ft: 20,
  width_ft: 8,
  height_ft: 7,
  is_stackable: false,
  is_fragile: false,
  special_requirements: '',
  payment_method_id: 'pm_test_123',
  upi_id: 'test@upi',
};

describe('POST /api/orders — server-side pricing contract', () => {
  beforeEach(() => {
    // Ensure each table exists in the in-memory store (the mock
    // auto-creates on first .from(), but we want to reset between tests).
    m.store.orders = [];
    m.store.order_timeline = [];
    m.store.load_offers = [];
    m.calls.length = 0;
    routeEstimateMock.mockReset();
    routeEstimateMock.mockResolvedValue(null);
  });

  it('happy path: 201, server-computed pricing persisted, no client monetary field in store', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/orders')
      .set(CUSTOMER_HEADERS)
      .send(validOrderBody);

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('order');

    // Find the orders.insert call
    const ordersInsert = m.calls.find(c => c.table === 'orders' && c.mode === 'insert');
    expect(ordersInsert, 'orders.insert should be called').toBeTruthy();
    const persisted = ordersInsert.payload;

    // Server-computed values are paisa integers, derived from rate card
    expect(persisted.base_freight).toBeGreaterThan(0);
    expect(persisted.toll_estimate).toBeGreaterThan(0);
    expect(persisted.platform_fee).toBeGreaterThan(0);
    expect(persisted.total_amount).toBe(
      persisted.base_freight + persisted.toll_estimate + persisted.platform_fee
    );
    // No client monetary field was ever read off the body.
    // (The destructure on the old line 64 dropped all 4 client fields
    //  from req.body before the insert — see PR #299 commit 6cc8ce8.)
    expect(persisted.base_freight).not.toBe(1);
    expect(persisted.total_amount).not.toBe(1);
  });

  it('CLIENT PRICING IGNORED: body includes base_freight:1 / total_amount:1 → server values still win', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/orders')
      .set(CUSTOMER_HEADERS)
      .send({ ...validOrderBody, base_freight: 1, toll_estimate: 1, platform_fee: 1, total_amount: 1 });

    expect(res.status).toBe(201);
    const ordersInsert = m.calls.find(c => c.table === 'orders' && c.mode === 'insert');
    const persisted = ordersInsert.payload;
    expect(persisted.base_freight).toBeGreaterThan(1);
    expect(persisted.toll_estimate).toBeGreaterThan(1);
    expect(persisted.platform_fee).toBeGreaterThan(1);
    expect(persisted.total_amount).toBeGreaterThan(1);
  });

  it('load_offers mirrors orders: freight_value === orders.base_freight, etc.', async () => {
    const app = buildApp();
    await request(app).post('/api/orders').set(CUSTOMER_HEADERS).send(validOrderBody);

    const orderInsert   = m.calls.find(c => c.table === 'orders' && c.mode === 'insert').payload;
    const offerInsert   = m.calls.find(c => c.table === 'load_offers' && c.mode === 'insert').payload;
    expect(offerInsert.freight_value).toBe(orderInsert.base_freight);
    expect(offerInsert.toll_cost).toBe(orderInsert.toll_estimate);
    // fuelCost + toll_cost + net_profit = baseFreight (the driver-side ledger invariant)
    expect(offerInsert.fuel_cost + offerInsert.toll_cost + offerInsert.net_profit)
      .toBe(offerInsert.freight_value);
  });

  it('uses OSRM road distance for persisted pricing when routing succeeds', async () => {
    routeEstimateMock.mockResolvedValueOnce({ distanceKm: 1423.456, durationSeconds: 90000 });
    const app = buildApp();

    const res = await request(app)
      .post('/api/orders')
      .set(CUSTOMER_HEADERS)
      .send(validOrderBody);

    expect(res.status).toBe(201);
    expect(routeEstimateMock).toHaveBeenCalledWith({
      pickupLat: validOrderBody.pickup_lat,
      pickupLng: validOrderBody.pickup_lng,
      dropLat: validOrderBody.drop_lat,
      dropLng: validOrderBody.drop_lng,
    });

    const orderInsert = m.calls.find(c => c.table === 'orders' && c.mode === 'insert').payload;
    const straightLinePricing = computeOrderPricing({
      pickupLat: validOrderBody.pickup_lat,
      pickupLng: validOrderBody.pickup_lng,
      dropLat: validOrderBody.drop_lat,
      dropLng: validOrderBody.drop_lng,
      weightTonnes: validOrderBody.weight_tonnes,
    });

    expect(orderInsert.base_freight).not.toBe(straightLinePricing.baseFreight);
    expect(orderInsert.toll_estimate).toBe(Math.round(200 * 1423.456));
  });

  it('bad coordinates: NaN drop_lat → 400 with a clear pricing error', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/orders')
      .set(CUSTOMER_HEADERS)
      .send({ ...validOrderBody, drop_lat: 'not-a-number' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('zero weight → 400', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/orders')
      .set(CUSTOMER_HEADERS)
      .send({ ...validOrderBody, weight_tonnes: 0 });
    expect(res.status).toBe(400);
  });

  it('regression: NO `const { base_freight } = pricing` destructure in route handler', async () => {
    // Static check — lock in the maintainer-caught camelCase/snake_case bug
    // so a future refactor cannot reintroduce it.
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const routeSrc = await fs.readFile(
      path.resolve(here, '../../src/routes/orderRoutes.js'),
      'utf8'
    );
    expect(
      routeSrc,
      'orderRoutes.js must NOT destructure pricing into snake_case locals (regression of b04413e)'
    ).not.toMatch(/const\s*\{\s*base_freight\s*,\s*toll_estimate\s*,\s*platform_fee\s*,\s*total_amount\s*\}\s*=\s*pricing/);
  });

  it('regression: NO client monetary fields in the orders.insert payload', async () => {
    // The route should not read base_freight/toll_estimate/platform_fee/total_amount
    // from req.body at all. If it does, the fix is regressed.
    const app = buildApp();
    await request(app).post('/api/orders').set(CUSTOMER_HEADERS).send({
      ...validOrderBody,
      base_freight: 99999, toll_estimate: 99999, platform_fee: 99999, total_amount: 99999,
    });
    const orderInsert = m.calls.find(c => c.table === 'orders' && c.mode === 'insert').payload;
    expect(orderInsert.base_freight).not.toBe(99999);
    expect(orderInsert.toll_estimate).not.toBe(99999);
    expect(orderInsert.platform_fee).not.toBe(99999);
    expect(orderInsert.total_amount).not.toBe(99999);
  });
  it('driver can update milestone when assigned to order', async () => {
    m.store.orders = [{
      id: 'order-1',
      driver_id: 'driver-123',
      order_display_id: 'ORD001',
      status: 'truck_assigned'
    }];

    m.store.order_timeline = [{
      order_display_id: 'ORD001',
      milestone: 'Goods Loaded',
      completed: false
    }];

    const app = buildApp();

    const res = await request(app)
      .put('/api/orders/order-1/milestones')
      .set({
        'x-user-id': 'driver-123',
        'x-user-role': 'driver'
      })
      .send({
        milestone: 'Goods Loaded'
      });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/Milestone updated successfully/i);
  });

  it('returns 403 when driver is not assigned to order', async () => {
    m.store.orders = [{
      id: 'order-1',
      driver_id: 'driver-999',
      order_display_id: 'ORD001'
    }];

    const app = buildApp();

    const res = await request(app)
      .put('/api/orders/order-1/milestones')
      .set({
        'x-user-id': 'driver-123',
        'x-user-role': 'driver'
      })
      .send({
        milestone: 'Goods Loaded'
      });

    expect(res.status).toBe(403);
  });
});

describe('POST /api/orders/:id/bids — duplicate bid prevention', () => {
  beforeEach(() => {
    m.store.load_offers = [];
    m.store.load_bids = [];
    m.calls.length = 0;
  });

  it('rejects a duplicate pending bid from the same driver on the same load', async () => {
    const app = buildApp();
    m.store.load_offers.push({
      id: 'load-duplicate',
      status: 'available',
    });
    m.store.load_bids.push({
      id: 'existing-bid',
      load_id: 'load-duplicate',
      driver_id: DRIVER_HEADERS['x-user-id'],
      bid_amount: 500000,
      status: 'pending',
    });

    const res = await request(app)
      .post('/api/orders/load-duplicate/bids')
      .set(DRIVER_HEADERS)
      .send({ bid_amount: 510000 });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'You already have a pending bid for this load.' });
    const bidInserts = m.calls.filter(c => c.table === 'load_bids' && c.mode === 'insert');
    expect(bidInserts).toHaveLength(0);
  });
});

describe('POST /api/orders/:id/bids/:bidId/accept — bid ownership', () => {
  beforeEach(() => {
    m.store.orders = [];
    m.store.load_offers = [];
    m.store.load_bids = [];
    m.store.profiles = [];
    m.store.driver_details = [];
    m.store.trucks = [];
    m.calls.length = 0;
  });

  it('rejects a pending bid when it belongs to a different order load offer', async () => {
    const app = buildApp();
    m.store.orders.push({
      id: 'order-owned',
      order_display_id: 'ORDER-OWNED',
      customer_id: CUSTOMER_HEADERS['x-user-id'],
    });
    m.store.load_offers.push({
      id: 'load-owned',
      order_display_id: 'ORDER-OWNED',
      customer_id: CUSTOMER_HEADERS['x-user-id'],
    });
    m.store.load_bids.push({
      id: 'bid-from-other-load',
      load_id: 'load-other',
      driver_id: 'driver-other',
      bid_amount: 42000,
      status: 'pending',
    });

    const res = await request(app)
      .post('/api/orders/order-owned/bids/bid-from-other-load/accept')
      .set(CUSTOMER_HEADERS)
      .send();

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Access Denied: Bid does not belong to this order.' });
    expect(m.calls.some(c => c.rpc === 'accept_bid_tx')).toBe(false);
  });
});
