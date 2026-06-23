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
import crypto from 'crypto';

const routeEstimateMock = vi.fn();

// Hoisted mock: swap supabase out for our in-memory builder.
const { createSupabaseMock } = await vi.importActual('../helpers/supabaseMock.js');

const m = createSupabaseMock();

const originalRpc = m.supabase.rpc;
m.supabase.rpc = vi.fn().mockImplementation(async (fnName, args) => {
  if (fnName === 'complete_trip_tx') {
    m.calls.push({ rpc: fnName, args });
    const orderId = args.p_order_id;
    const order = m.store.orders.find(o => o.id === orderId);
    if (order) {
      order.otp_verified = true;
      order.status = 'payment_released';
      order.updated_at = new Date().toISOString();
      const timeline = m.store.order_timeline.find(t => t.order_display_id === order.order_display_id && t.milestone === 'Delivered');
      if (timeline) {
        timeline.completed = true;
        timeline.milestone_time = new Date().toISOString();
      }
    }
    return { data: null, error: null };
  }
  return originalRpc(fnName, args);
});
let mockRedis = null;

vi.mock('../../src/config/db.js', () => ({
  supabase: m.supabase,
  firebaseAdmin: null,
  get redisClient() { return mockRedis; },
  mongoDb: null,
}));

vi.mock('../../src/sockets/tracker.js', () => ({
  initWebSocketServer: () => ({}),
}));

vi.mock('../../src/services/osrm.js', () => ({
  getRouteEstimate: routeEstimateMock,
}));

// Mock reputation service so tests never hit a real blockchain node.
// awardReputationPointsMock is a vi.fn() the tests can inspect and configure.
const awardReputationPointsMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/services/reputation.js', () => ({
  reputationContract: {},
  awardReputationPoints: awardReputationPointsMock,
}));

const escrowReleaseMock = vi.fn();
vi.mock('../../src/services/escrow.js', async () => {
  const actual = await vi.importActual('../../src/services/escrow.js');
  return {
    ...actual,
    escrowRelease: escrowReleaseMock,
  };
});

const predictDemandMock = vi.fn();
vi.mock('../../src/services/ml.js', () => ({
  predictDemand: predictDemandMock,
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
    escrowReleaseMock.mockReset();
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

  it('accepts zero-valued coordinates when they are in range', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/orders')
      .set(CUSTOMER_HEADERS)
      .send({ ...validOrderBody, pickup_lat: 0, pickup_lng: 0 });

    expect(res.status).toBe(201);
  });

  it('bad coordinates: NaN drop_lat → 400 with structured validation details', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/orders')
      .set(CUSTOMER_HEADERS)
      .send({ ...validOrderBody, drop_lat: 'not-a-number' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'drop_lat',
          message: expect.any(String),
        }),
      ])
    );
  });

  it('invalid pickup_date format → 400 with field-level validation details', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/orders')
      .set(CUSTOMER_HEADERS)
      .send({ ...validOrderBody, pickup_date: 'tomorrow' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'pickup_date',
          message: 'Must be a valid ISO date string',
        }),
      ])
    );
  });

  it('zero weight → 400', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/orders')
      .set(CUSTOMER_HEADERS)
      .send({ ...validOrderBody, weight_tonnes: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'weight_tonnes',
          message: 'Must be greater than 0',
        }),
      ])
    );
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

  it('En Route to Pickup milestone does not set status to picked_up', async () => {
    m.store.orders = [{
      id: 'order-1',
      driver_id: 'driver-123',
      order_display_id: 'ORD001',
      status: 'truck_assigned'
    }];

    m.store.order_timeline = [{
      order_display_id: 'ORD001',
      milestone: 'En Route to Pickup',
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
        milestone: 'En Route to Pickup'
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('en_route_pickup');
    expect(res.body.status).not.toBe('picked_up');
  });

  it('Arrived at Pickup milestone sets status to arrived_pickup', async () => {
    m.store.orders = [{
      id: 'order-1',
      driver_id: 'driver-123',
      order_display_id: 'ORD001',
      status: 'en_route_pickup'
    }];

    m.store.order_timeline = [{
      order_display_id: 'ORD001',
      milestone: 'Arrived at Pickup',
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
        milestone: 'Arrived at Pickup'
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('arrived_pickup');
  });

  it('Goods Loaded milestone sets status to picked_up', async () => {
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
    expect(res.body.status).toBe('picked_up');
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

  it('returns 500 when orders insert fails', async () => {
    routeEstimateMock.mockResolvedValue(null);
    m.programError('insert failed');

    const app = buildApp();

    const res = await request(app)
      .post('/api/orders')
      .set(CUSTOMER_HEADERS)
      .send(validOrderBody);

    expect(res.status).toBe(500);
  });
});

describe('POST /api/orders/:id/bids — duplicate bid prevention', () => {
  beforeEach(() => {
    m.store.load_offers = [];
    m.store.load_bids = [];
    m.store.driver_details = [];
    m.store.trucks = [];
    m.calls.length = 0;
  });

  it('rejects a duplicate pending bid from the same driver on the same load', async () => {
    const app = buildApp();
    m.store.load_offers.push({
      id: 'load-duplicate',
      status: 'available',
      customer_id: 'customer-1',
    });
    m.store.driver_details.push({
      user_id: DRIVER_HEADERS['x-user-id'],
      truck_id: 'truck-1',
    });
    m.store.trucks.push({
      id: 'truck-1',
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

  it('returns 404 when load offer for order not found', async () => {
    m.store.orders.push({
      id: 'order-1',
      order_display_id: 'OD-NOOFFER',
      customer_id: CUSTOMER_HEADERS['x-user-id'],
    });

    m.store.load_bids.push({
      id: 'bid-1',
      load_id: 'load-1',
      driver_id: 'driver-1',
      bid_amount: 50000,
      status: 'pending',
    });

    const app = buildApp();

    const res = await request(app)
      .post('/api/orders/order-1/bids/bid-1/accept')
      .set(CUSTOMER_HEADERS);

    expect(res.status).toBe(404);
  });
});

describe('GET /api/orders/history — order history', () => {
  beforeEach(() => {
    m.store.orders = [];
    m.calls.length = 0;
  });

  it('returns order history for customer', async () => {
    m.store.orders.push({
      id: 'order-1',
      customer_id: CUSTOMER_HEADERS['x-user-id'],
      status: 'pending',
      created_at: '2026-06-01',
    });

    const app = buildApp();

    const res = await request(app)
      .get('/api/orders/history')
      .set(CUSTOMER_HEADERS);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('returns 500 on DB error', async () => {
    m.programError('db failure');

    const app = buildApp();

    const res = await request(app)
      .get('/api/orders/history')
      .set(CUSTOMER_HEADERS);

    expect(res.status).toBe(500);
  });
});

describe('GET /api/orders/:id — order details', () => {
  beforeEach(() => {
    m.store.orders = [];
    m.store.order_timeline = [];
    m.store.profiles = [];
    m.store.driver_details = [];
    m.calls.length = 0;
  });

  it('returns 404 when order not found', async () => {
    const app = buildApp();

    const res = await request(app)
      .get('/api/orders/nonexistent-id')
      .set(CUSTOMER_HEADERS);

    expect(res.status).toBe(404);
  });

  it('returns 403 when user does not own the order', async () => {
    m.store.orders.push({
      id: 'order-1',
      customer_id: 'someone-else',
      driver_id: null,
      order_display_id: 'OD1',
    });

    const app = buildApp();

    const res = await request(app)
      .get('/api/orders/order-1')
      .set(CUSTOMER_HEADERS);

    expect(res.status).toBe(403);
  });

  it('returns order details with timeline for owner', async () => {
    m.store.orders.push({
      id: 'order-1',
      customer_id: CUSTOMER_HEADERS['x-user-id'],
      driver_id: null,
      order_display_id: 'OD1',
    });

    m.store.order_timeline.push({
      order_display_id: 'OD1',
      milestone: 'Order Placed',
      completed: true,
      sort_order: 10,
    });

    const app = buildApp();

    const res = await request(app)
      .get('/api/orders/order-1')
      .set(CUSTOMER_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.order.id).toBe('order-1');
    expect(Array.isArray(res.body.timeline)).toBe(true);
  });

  it('returns order details with driver profile when driver assigned', async () => {
    m.store.orders.push({
      id: 'order-2',
      customer_id: CUSTOMER_HEADERS['x-user-id'],
      driver_id: 'driver-1',
      order_display_id: 'OD2',
    });

    m.store.profiles.push({
      id: 'driver-1',
      full_name: 'Test Driver',
      phone: '9999999999',
      avatar_url: null,
    });

    m.store.driver_details.push({
      user_id: 'driver-1',
      rating: 4.8,
      total_trips: 30,
    });

    const app = buildApp();

    const res = await request(app)
      .get('/api/orders/order-2')
      .set(CUSTOMER_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.driver.name).toBe('Test Driver');
  });

  it('does not expose delivery_otp on order for any role (isolated table)', async () => {
    m.store.orders.push({
      id: 'order-3',
      customer_id: 'customer-123',
      driver_id: 'driver-123',
      order_display_id: 'OD3',
    });

    const app = buildApp();

    // 1. Customer request — no delivery_otp on order object
    const customerRes = await request(app)
      .get('/api/orders/order-3')
      .set({
        'x-user-id': 'customer-123',
        'x-user-role': 'customer'
      });
    expect(customerRes.status).toBe(200);
    expect(customerRes.body.order).not.toHaveProperty('delivery_otp');

    // 2. Driver request — also no delivery_otp
    const driverRes = await request(app)
      .get('/api/orders/order-3')
      .set({
        'x-user-id': 'driver-123',
        'x-user-role': 'driver'
      });
    expect(driverRes.status).toBe(200);
    expect(driverRes.body.order).not.toHaveProperty('delivery_otp');
  });

  it('returns 500 on DB error', async () => {
    m.programError('db failure');

    const app = buildApp();

    const res = await request(app)
      .get('/api/orders/order-1')
      .set(CUSTOMER_HEADERS);

    expect(res.status).toBe(500);
  });
});

describe('POST /api/orders — missing required fields', () => {
  beforeEach(() => {
    m.store.orders = [];
    m.calls.length = 0;
    routeEstimateMock.mockReset();
  });

  it('returns 400 when required fields are missing', async () => {
    const app = buildApp();

    const res = await request(app)
      .post('/api/orders')
      .set(CUSTOMER_HEADERS)
      .send({ pickup_address: '123 St' }); // missing most required fields

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'pickup_lat' }),
        expect.objectContaining({ field: 'pickup_lng' }),
        expect.objectContaining({ field: 'drop_lat' }),
        expect.objectContaining({ field: 'drop_lng' }),
        expect.objectContaining({ field: 'weight_tonnes' }),
        expect.objectContaining({ field: 'pickup_date' }),
      ])
    );
  });
});

describe('PUT /api/orders/:id/milestones — edge cases', () => {
  beforeEach(() => {
    m.store.orders = [];
    m.store.order_timeline = [];
    m.calls.length = 0;
  });

  it('returns 400 for invalid milestone', async () => {
    const app = buildApp();

    const res = await request(app)
      .put('/api/orders/order-1/milestones')
      .set(DRIVER_HEADERS)
      .send({ milestone: 'Invalid Milestone' });

    expect(res.status).toBe(400);
  });

  it('returns 404 when order not found', async () => {
    const app = buildApp();

    const res = await request(app)
      .put('/api/orders/nonexistent/milestones')
      .set(DRIVER_HEADERS)
      .send({ milestone: 'Goods Loaded' });

    expect(res.status).toBe(404);
  });

  it('returns 500 when order update fails', async () => {
    m.store.orders.push({
      id: 'order-1',
      driver_id: DRIVER_HEADERS['x-user-id'],
      order_display_id: 'OD1',
    });

    const originalFrom = m.supabase.from.bind(m.supabase);
    m.supabase.from = (table) => {
      const builder = originalFrom(table);
      if (table === 'orders') {
        const originalUpdate = builder.update.bind(builder);
        builder.update = (payload) => {
          const b = originalUpdate(payload);
          b._exec = async () => ({ data: null, error: { message: 'update failed' } });
          return b;
        };
      }
      return builder;
    };

    const app = buildApp();

    const res = await request(app)
      .put('/api/orders/order-1/milestones')
      .set(DRIVER_HEADERS)
      .send({ milestone: 'Goods Loaded' });

    m.supabase.from = originalFrom;

    expect(res.status).toBe(500);
  });
  
});

describe('GET /api/orders/:id/bids — bids query error', () => {
  beforeEach(() => {
    m.store.orders = [];
    m.store.load_offers = [];
    m.store.load_bids = [];
    m.calls.length = 0;
  });

  it('returns 500 when bids query fails', async () => {
    m.store.orders.push({
      id: 'order-1',
      customer_id: CUSTOMER_HEADERS['x-user-id'],
      order_display_id: 'OD1',
    });

    m.store.load_offers.push({
      id: 'load-1',
      order_display_id: 'OD1',
    });

    const originalFrom = m.supabase.from.bind(m.supabase);
    m.supabase.from = (table) => {
      const builder = originalFrom(table);
      if (table === 'load_bids') {
        builder._exec = async () => ({ data: null, error: { message: 'bids query failed' } });
      }
      return builder;
    };

    const app = buildApp();

    const res = await request(app)
      .get('/api/orders/order-1/bids')
      .set(CUSTOMER_HEADERS);

    m.supabase.from = originalFrom;

    expect(res.status).toBe(500);
  });
});

describe('PUT /api/orders/:id/milestones — timeline update error', () => {
  beforeEach(() => {
    m.store.orders = [];
    m.store.order_timeline = [];
    m.calls.length = 0;
  });

  it('returns 500 when timeline update fails', async () => {
    m.store.orders.push({
      id: 'order-1',
      driver_id: DRIVER_HEADERS['x-user-id'],
      order_display_id: 'OD1',
    });

    m.store.order_timeline.push({
      order_display_id: 'OD1',
      milestone: 'In Transit',
      completed: false,
    });

    const originalFrom = m.supabase.from.bind(m.supabase);
    m.supabase.from = (table) => {
      const builder = originalFrom(table);
      if (table === 'order_timeline') {
        const originalUpdate = builder.update.bind(builder);
        builder.update = (payload) => {
          const b = originalUpdate(payload);
          b._exec = async () => ({ data: null, error: { message: 'timeline update failed' } });
          return b;
        };
      }
      return builder;
    };

    const app = buildApp();

    const res = await request(app)
      .put('/api/orders/order-1/milestones')
      .set(DRIVER_HEADERS)
      .send({ milestone: 'In Transit' });

    m.supabase.from = originalFrom;

    expect(res.status).toBe(500);
  });
});

describe('Delivery OTP Verification and Milestones', () => {
  beforeEach(() => {
    m.store.orders = [];
    m.store.order_timeline = [];
    m.store.load_offers = [];
    m.store.load_bids = [];
    m.store.profiles = [];
    m.store.driver_details = [];
    m.store.trucks = [];
    m.calls.length = 0;
  });

  it('blocks direct transition to Delivered milestone with descriptive message', async () => {
    m.store.orders = [{
      id: 'order-1',
      driver_id: 'driver-123',
      order_display_id: 'ORD001',
      status: 'in_transit'
    }];

    const app = buildApp();
    const res = await request(app)
      .put('/api/orders/order-1/milestones')
      .set({
        'x-user-id': 'driver-123',
        'x-user-role': 'driver'
      })
      .send({ milestone: 'Delivered' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Cannot set Delivered milestone directly. Use /verify-delivery endpoint to confirm delivery.');
  });

  it('generates OTP in isolated table but does not return it in response when moving to In Transit milestone', async () => {
    m.store.orders = [{
      id: 'order-1',
      customer_id: 'customer-456',
      driver_id: 'driver-123',
      order_display_id: 'ORD001',
      status: 'picked_up'
    }];
    m.store.order_timeline = [{
      order_display_id: 'ORD001',
      milestone: 'In Transit',
      completed: false
    }];
    m.store.notifications = [];
    m.store.delivery_otps = []; // ensure no stale OTP from prior tests

    const app = buildApp();
    const res = await request(app)
      .put('/api/orders/order-1/milestones')
      .set({
        'x-user-id': 'driver-123',
        'x-user-role': 'driver'
      })
      .send({ milestone: 'In Transit' });

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('otp');
    expect(res.body.order).not.toHaveProperty('delivery_otp');

    const otpRecord = m.store.delivery_otps.find(o => o.order_id === 'order-1');
    expect(otpRecord).toBeTruthy();
    expect(otpRecord.otp_hash).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hash
    expect(otpRecord.verified).toBe(false);
    expect(otpRecord.expires_at).toBeDefined();

    // Verify customer notification was created
    const notification = m.store.notifications.find(n => n.user_id === 'customer-456');
    expect(notification).toBeTruthy();
    const otpInNotification = notification.body.match(/\b\d{6}\b/)[0];
    const expectedHash = crypto.createHash('sha256').update(otpInNotification).digest('hex');
    expect(otpRecord.otp_hash).toBe(expectedHash);
    expect(notification.notif_type).toBe('order_update');
  });

  it('fails OTP verification if missing OTP', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/orders/order-1/verify-delivery')
      .set({
        'x-user-id': 'driver-123',
        'x-user-role': 'driver'
      })
      .send({}); // Missing OTP

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('OTP is required for verification.');
  });

  it('fails OTP verification if driver is not assigned', async () => {
    m.store.orders = [{
      id: 'order-1',
      driver_id: 'driver-different',
      order_display_id: 'ORD001',
      delivery_otp: '123456',
      otp_verified: false
    }];

    const app = buildApp();
    const res = await request(app)
      .post('/api/orders/order-1/verify-delivery')
      .set({
        'x-user-id': 'driver-123',
        'x-user-role': 'driver'
      })
      .send({ otp: '123456' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Access Denied: You are not assigned to this order.');
  });

  it('fails OTP verification if OTP is invalid', async () => {
    m.store.orders = [{
      id: 'order-1',
      driver_id: 'driver-123',
      order_display_id: 'ORD001'
    }];
    m.store.delivery_otps = [{
      id: 'otp-1',
      order_id: 'order-1',
      otp_hash: crypto.createHash('sha256').update('123456').digest('hex'),
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      verified: false,
      created_at: new Date().toISOString()
    }];

    const app = buildApp();
    const res = await request(app)
      .post('/api/orders/order-1/verify-delivery')
      .set({
        'x-user-id': 'driver-123',
        'x-user-role': 'driver'
      })
      .send({ otp: '654321' }); // Invalid OTP

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid OTP');
  });

  it('verifies delivery successfully with correct OTP, updates status and calls RPC', async () => {
    m.store.orders = [{
      id: 'order-1',
      driver_id: 'driver-123',
      order_display_id: 'ORD001',
      status: 'in_transit'
    }];
    m.store.delivery_otps = [{
      id: 'otp-1',
      order_id: 'order-1',
      otp_hash: crypto.createHash('sha256').update('123456').digest('hex'),
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      verified: false,
      created_at: new Date().toISOString()
    }];
    m.store.order_timeline = [{
      order_display_id: 'ORD001',
      milestone: 'Delivered',
      completed: false
    }];

    const app = buildApp();
    const res = await request(app)
      .post('/api/orders/order-1/verify-delivery')
      .set({
        'x-user-id': 'driver-123',
        'x-user-role': 'driver'
      })
      .send({ otp: 123456 }); // Numeric input, verifies type safety

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/Delivery verified successfully/i);

    const order = m.store.orders.find(o => o.id === 'order-1');
    expect(order.status).toBe('payment_released');

    // OTP record should be marked as verified in isolated table
    const otpRecord = m.store.delivery_otps.find(o => o.order_id === 'order-1');
    expect(otpRecord.verified).toBe(true);

    const timeline = m.store.order_timeline.find(t => t.order_display_id === 'ORD001' && t.milestone === 'Delivered');
    expect(timeline.completed).toBe(true);

    const rpcCall = m.calls.find(c => c.rpc === 'complete_trip_tx');
    expect(rpcCall).toBeTruthy();
    expect(rpcCall.args).toEqual({ p_order_id: 'order-1' });
  });

  it('persists the escrow payout hash to wallet_transactions after delivery verification', async () => {
    escrowReleaseMock.mockResolvedValue({
      txHash: '0xtesthash',
      bookingId: 'booking-1',
    });

    m.store.orders = [{
      id: 'order-2',
      driver_id: 'driver-456',
      order_display_id: 'ORD002',
      status: 'in_transit',
      total_amount: 125000,
      escrow_status: 'funded',
    }];
    m.store.delivery_otps = [{
      id: 'otp-2',
      order_id: 'order-2',
      otp_hash: crypto.createHash('sha256').update('123456').digest('hex'),
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      verified: false,
      created_at: new Date().toISOString(),
    }];
    m.store.order_timeline = [{
      order_display_id: 'ORD002',
      milestone: 'Delivered',
      completed: false
    }];

    const app = buildApp();
    const res = await request(app)
      .post('/api/orders/order-2/verify-delivery')
      .set({
        'x-user-id': 'driver-456',
        'x-user-role': 'driver'
      })
      .send({ otp: 123456 });

    expect(res.status).toBe(200);

    const walletUpdate = m.calls.find(c => c.table === 'wallet_transactions' && c.mode === 'update');
    expect(walletUpdate).toBeTruthy();
    expect(walletUpdate.payload).toEqual(expect.objectContaining({
      tx_hash: '0xtesthash',
      description: 'Escrow payout for ORD002',
    }));
  });

  it('fails OTP verification if OTP is expired', async () => {
    m.store.orders = [{
      id: 'order-expired',
      driver_id: 'driver-123',
      order_display_id: 'ORD-EXP',
      status: 'in_transit'
    }];
    m.store.delivery_otps = [{
      id: 'otp-expired',
      order_id: 'order-expired',
      otp_hash: crypto.createHash('sha256').update('123456').digest('hex'),
      expires_at: new Date(Date.now() - 1 * 60 * 1000).toISOString(), // expired 1 minute ago
      verified: false,
      created_at: new Date(Date.now() - 20 * 60 * 1000).toISOString()
    }];

    const app = buildApp();
    const res = await request(app)
      .post('/api/orders/order-expired/verify-delivery')
      .set({
        'x-user-id': 'driver-123',
        'x-user-role': 'driver'
      })
      .send({ otp: '123456' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('expired');
  });

  it('enforces brute-force lockout after max failed attempts and allows reset after lockout time', async () => {
    const orderId = 'order-lockout';
    m.store.orders = [{
      id: orderId,
      driver_id: 'driver-123',
      order_display_id: 'ORD-LOCK',
      status: 'in_transit'
    }];
    m.store.delivery_otps = [{
      id: 'otp-lockout',
      order_id: orderId,
      otp_hash: crypto.createHash('sha256').update('123456').digest('hex'),
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      verified: false,
      created_at: new Date().toISOString()
    }];

    const app = buildApp();

    // 1. Fail 4 times, verifying remaining attempts message
    for (let i = 1; i <= 4; i++) {
      const res = await request(app)
        .post(`/api/orders/${orderId}/verify-delivery`)
        .set({
          'x-user-id': 'driver-123',
          'x-user-role': 'driver'
        })
        .send({ otp: '000000' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain(`${5 - i} attempt(s) remaining`);
    }

    // 2. 5th failure: triggers lockout
    const res5 = await request(app)
      .post(`/api/orders/${orderId}/verify-delivery`)
      .set({
        'x-user-id': 'driver-123',
        'x-user-role': 'driver'
      })
      .send({ otp: '000000' });
    expect(res5.status).toBe(400);
    expect(res5.body.error).toContain('Verification is locked');

    // 3. 6th attempt (even with correct OTP) returns 429 Too Many Requests
    const res6 = await request(app)
      .post(`/api/orders/${orderId}/verify-delivery`)
      .set({
        'x-user-id': 'driver-123',
        'x-user-role': 'driver'
      })
      .send({ otp: '123456' });
    expect(res6.status).toBe(429);
    expect(res6.body.error).toContain('Too many failed OTP attempts');

    // 4. Advance time by 31 minutes to bypass lockout
    const originalNow = Date.now;
    Date.now = () => originalNow() + 31 * 60 * 1000;

    // Update expires_at so the OTP itself isn't expired after lockout bypass
    m.store.delivery_otps[0].expires_at = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    try {
      // Correct OTP should now succeed
      const resAfterLockout = await request(app)
        .post(`/api/orders/${orderId}/verify-delivery`)
        .set({
          'x-user-id': 'driver-123',
          'x-user-role': 'driver'
        })
        .send({ otp: '123456' });
      expect(resAfterLockout.status).toBe(200);
      expect(resAfterLockout.body.message).toMatch(/Delivery verified successfully/i);
    } finally {
      Date.now = originalNow;
    }
  });

  it('clears lockout state on successful verification', async () => {
    const orderId = 'order-clear-state';
    m.store.orders = [{
      id: orderId,
      driver_id: 'driver-123',
      order_display_id: 'ORD-CLEAR',
      status: 'in_transit'
    }];
    m.store.delivery_otps = [{
      id: 'otp-clear-state',
      order_id: orderId,
      otp_hash: crypto.createHash('sha256').update('123456').digest('hex'),
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      verified: false,
      created_at: new Date().toISOString()
    }];

    const app = buildApp();

    // Fail 3 times (count is 3)
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post(`/api/orders/${orderId}/verify-delivery`)
        .set({
          'x-user-id': 'driver-123',
          'x-user-role': 'driver'
        })
        .send({ otp: '000000' });
    }

    // Succeed — this calls verifyDeliveryOtp which marks the OTP as verified
    const resSuccess = await request(app)
      .post(`/api/orders/${orderId}/verify-delivery`)
      .set({
        'x-user-id': 'driver-123',
        'x-user-role': 'driver'
      })
      .send({ otp: '123456' });
    expect(resSuccess.status).toBe(200);

    // Reset OTP record in isolated table so subsequent verifications can find it
    const otpRecord = m.store.delivery_otps.find(o => o.order_id === orderId);
    otpRecord.verified = false;
    delete otpRecord.verified_at;

    // Fail 4 more times (if state wasn't cleared, this would lockout since total failures would be 7)
    for (let i = 1; i <= 4; i++) {
      const resFail = await request(app)
        .post(`/api/orders/${orderId}/verify-delivery`)
        .set({
          'x-user-id': 'driver-123',
          'x-user-role': 'driver'
        })
        .send({ otp: '000000' });
      expect(resFail.status).toBe(400);
      expect(resFail.body.error).toContain(`${5 - i} attempt(s) remaining`);
    }
  });

  it('regenerates OTP in isolated table when milestone In Transit is called and existing OTP has expired', async () => {
    const orderId = 'order-regen';
    m.store.orders = [{
      id: orderId,
      customer_id: 'customer-456',
      driver_id: 'driver-123',
      order_display_id: 'ORD-REGEN',
      status: 'in_transit'
    }];
    m.store.delivery_otps = [{
      id: 'otp-regen-old',
      order_id: orderId,
      otp_hash: crypto.createHash('sha256').update('123456').digest('hex'),
      expires_at: new Date(Date.now() - 1 * 60 * 1000).toISOString(), // expired
      verified: false,
      created_at: new Date(Date.now() - 20 * 60 * 1000).toISOString()
    }];
    m.store.order_timeline = [{
      order_display_id: 'ORD-REGEN',
      milestone: 'In Transit',
      completed: true
    }];
    m.store.notifications = [];

    const app = buildApp();
    const res = await request(app)
      .put(`/api/orders/${orderId}/milestones`)
      .set({
        'x-user-id': 'driver-123',
        'x-user-role': 'driver'
      })
      .send({ milestone: 'In Transit' });

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('otp');
    expect(res.body.order).not.toHaveProperty('delivery_otp');

    // The old OTP should still be in the table
    const oldOtp = m.store.delivery_otps.find(o => o.id === 'otp-regen-old');
    expect(oldOtp).toBeTruthy();

    // A new OTP should have been created
    const expectedOldHash = crypto.createHash('sha256').update('123456').digest('hex');
    const newOtps = m.store.delivery_otps.filter(o => o.order_id === orderId && o.otp_hash !== expectedOldHash);
    expect(newOtps.length).toBeGreaterThan(0);
    const newOtp = newOtps[0];
    expect(newOtp.otp_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(newOtp.verified).toBe(false);
    expect(newOtp.expires_at).toBeDefined();

    // Verify customer notification was created with the new OTP
    const notification = m.store.notifications.find(n => n.user_id === 'customer-456');
    expect(notification).toBeTruthy();
    const otpInNotification = notification.body.match(/\b\d{6}\b/)[0];
    const expectedNewHash = crypto.createHash('sha256').update(otpInNotification).digest('hex');
    expect(newOtp.otp_hash).toBe(expectedNewHash);
  });

  describe('Redis-based rate limiting & error fallback resilience', () => {
    let redisStore;
    let redisCalls;
    let activeMockRedis;
    let failingMockRedis;

    beforeEach(() => {
      redisStore = new Map();
      redisCalls = [];
      
      activeMockRedis = {
        get: vi.fn(async (key) => {
          redisCalls.push({ method: 'get', key });
          return redisStore.get(key);
        }),
        incr: vi.fn(async (key) => {
          redisCalls.push({ method: 'incr', key });
          const val = (parseInt(redisStore.get(key) || '0', 10) + 1).toString();
          redisStore.set(key, val);
          return parseInt(val, 10);
        }),
        expire: vi.fn(async (key, ttl) => {
          redisCalls.push({ method: 'expire', key, ttl });
          return 1;
        }),
        set: vi.fn(async (key, val, mode, ttl) => {
          redisCalls.push({ method: 'set', key, val, mode, ttl });
          redisStore.set(key, val);
          return 'OK';
        }),
        del: vi.fn(async (...keys) => {
          redisCalls.push({ method: 'del', keys });
          for (const key of keys) {
            redisStore.delete(key);
          }
          return keys.length;
        })
      };

      failingMockRedis = {
        get: vi.fn(async () => { throw new Error('Redis connection lost'); }),
        incr: vi.fn(async () => { throw new Error('Redis connection lost'); }),
        expire: vi.fn(async () => { throw new Error('Redis connection lost'); }),
        set: vi.fn(async () => { throw new Error('Redis connection lost'); }),
        del: vi.fn(async () => { throw new Error('Redis connection lost'); })
      };

      mockRedis = null; // defaults to null
    });

    it('uses active Redis client to store verification failures and locks out after max attempts', async () => {
      mockRedis = activeMockRedis;

      m.store.orders = [{
        id: 'order-redis-active',
        driver_id: 'driver-123',
        customer_id: 'customer-456',
        order_display_id: 'ORD-REDIS'
      }];
      m.store.delivery_otps = [{
        id: 'otp-redis-active',
        order_id: 'order-redis-active',
        otp_hash: crypto.createHash('sha256').update('123456').digest('hex'),
        expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        verified: false,
        created_at: new Date().toISOString()
      }];

      const app = buildApp();

      // Send 1st invalid OTP
      const res1 = await request(app)
        .post('/api/orders/order-redis-active/verify-delivery')
        .set({ 'x-user-id': 'driver-123', 'x-user-role': 'driver' })
        .send({ otp: '000000' });
      expect(res1.status).toBe(400);
      expect(res1.body.error).toContain('Invalid OTP. 4 attempt(s) remaining');
      expect(redisStore.get('otp_failed_count:order-redis-active')).toBe('1');

      // Send remaining attempts to reach 5
      for (let i = 0; i < 4; i++) {
        await request(app)
          .post('/api/orders/order-redis-active/verify-delivery')
          .set({ 'x-user-id': 'driver-123', 'x-user-role': 'driver' })
          .send({ otp: '000000' });
      }

      expect(redisStore.get('otp_failed_count:order-redis-active')).toBe('5');
      expect(redisStore.get('otp_lockout:order-redis-active')).toBe('1');

      // Verify next request is blocked with 429 even with correct OTP
      const res6 = await request(app)
        .post('/api/orders/order-redis-active/verify-delivery')
        .set({ 'x-user-id': 'driver-123', 'x-user-role': 'driver' })
        .send({ otp: '123456' });
      expect(res6.status).toBe(429);
      expect(res6.body.error).toContain('Too many failed OTP attempts');

      // Expire the OTP in the isolated table so the milestone triggers regeneration
      m.store.delivery_otps[0].expires_at = new Date(Date.now() - 1 * 60 * 1000).toISOString();

      // Milestone change clears lockout in Redis and generates new OTP
      await request(app)
        .put('/api/orders/order-redis-active/milestones')
        .set({ 'x-user-id': 'driver-123', 'x-user-role': 'driver' })
        .send({ milestone: 'In Transit' });
      expect(redisStore.get('otp_failed_count:order-redis-active')).toBeUndefined();
      expect(redisStore.get('otp_lockout:order-redis-active')).toBeUndefined();
    });

    it('gracefully falls back to in-memory rate limiting when Redis client throws error (resilience)', async () => {
      mockRedis = failingMockRedis;

      m.store.orders = [{
        id: 'order-redis-failing',
        driver_id: 'driver-123',
        customer_id: 'customer-456',
        order_display_id: 'ORD-FAIL-REDIS'
      }];
      m.store.delivery_otps = [{
        id: 'otp-redis-failing',
        order_id: 'order-redis-failing',
        otp_hash: crypto.createHash('sha256').update('123456').digest('hex'),
        expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        verified: false,
        created_at: new Date().toISOString()
      }];

      const app = buildApp();

      // Verify that even if Redis fails, the endpoint handles it gracefully and returns 400 (not 500)
      const res1 = await request(app)
        .post('/api/orders/order-redis-failing/verify-delivery')
        .set({ 'x-user-id': 'driver-123', 'x-user-role': 'driver' })
        .send({ otp: '000000' });
      
      expect(res1.status).toBe(400);
      expect(res1.body.error).toContain('Invalid OTP. 4 attempt(s) remaining');

      // Lockout is still recorded in memory
      for (let i = 0; i < 4; i++) {
        await request(app)
          .post('/api/orders/order-redis-failing/verify-delivery')
          .set({ 'x-user-id': 'driver-123', 'x-user-role': 'driver' })
          .send({ otp: '000000' });
      }

      // 6th attempt should return 429
      const res6 = await request(app)
        .post('/api/orders/order-redis-failing/verify-delivery')
        .set({ 'x-user-id': 'driver-123', 'x-user-role': 'driver' })
        .send({ otp: '123456' });
      
      expect(res6.status).toBe(429);
      expect(res6.body.error).toContain('Too many failed OTP attempts');
    });
  });
});

describe('POST /api/orders/:id/ratings — delivered order reputation flow', () => {
  beforeEach(() => {
    m.store.orders = [];
    m.store.ratings = [];
    m.calls.length = 0;
  });

  it('submits a rating for the order owner after delivery and calls submit_rating_tx', async () => {
    m.store.orders = [{
      id: 'order-1',
      order_display_id: 'ORD-1',
      customer_id: CUSTOMER_HEADERS['x-user-id'],
      driver_id: 'driver-123',
      status: 'payment_released',
    }];

    const app = buildApp();
    const res = await request(app)
      .post('/api/orders/order-1/ratings')
      .set(CUSTOMER_HEADERS)
      .send({ stars: 5, comment: 'Great delivery' });

    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Rating submitted successfully.');
    expect(m.calls.some(c => c.rpc === 'submit_rating_tx')).toBe(true);

    const rpcCall = m.calls.find(c => c.rpc === 'submit_rating_tx');
    expect(rpcCall.args).toEqual({
      p_order_display_id: 'ORD-1',
      p_customer_id: CUSTOMER_HEADERS['x-user-id'],
      p_driver_id: 'driver-123',
      p_stars: 5,
      p_comment: 'Great delivery',
    });
  });

  it('rejects duplicate ratings for the same order', async () => {
    m.store.orders = [{
      id: 'order-1',
      order_display_id: 'ORD-1',
      customer_id: CUSTOMER_HEADERS['x-user-id'],
      driver_id: 'driver-123',
      status: 'payment_released',
    }];
    m.store.ratings = [{
      id: 'rating-1',
      order_display_id: 'ORD-1',
      customer_id: CUSTOMER_HEADERS['x-user-id'],
      driver_id: 'driver-123',
      stars: 5,
    }];

    const app = buildApp();
    const res = await request(app)
      .post('/api/orders/order-1/ratings')
      .set(CUSTOMER_HEADERS)
      .send({ stars: 4, comment: 'Second attempt' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('A rating has already been submitted for this order.');
    expect(m.calls.some(c => c.rpc === 'submit_rating_tx')).toBe(false);
  });

  it('rejects rating submission before delivery', async () => {
    m.store.orders = [{
      id: 'order-1',
      order_display_id: 'ORD-1',
      customer_id: CUSTOMER_HEADERS['x-user-id'],
      driver_id: 'driver-123',
      status: 'in_transit',
    }];

    const app = buildApp();
    const res = await request(app)
      .post('/api/orders/order-1/ratings')
      .set(CUSTOMER_HEADERS)
      .send({ stars: 5, comment: 'Too early' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Order must be delivered before a rating can be submitted.');
    expect(m.calls.some(c => c.rpc === 'submit_rating_tx')).toBe(false);
  });

  it('rejects non-owner customers', async () => {
    m.store.orders = [{
      id: 'order-1',
      order_display_id: 'ORD-1',
      customer_id: 'someone-else',
      driver_id: 'driver-123',
      status: 'payment_released',
    }];

    const app = buildApp();
    const res = await request(app)
      .post('/api/orders/order-1/ratings')
      .set(CUSTOMER_HEADERS)
      .send({ stars: 5, comment: 'Not mine' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Access Denied: You do not own this order.');
    expect(m.calls.some(c => c.rpc === 'submit_rating_tx')).toBe(false);
  });

  it('rejects invalid rating payloads', async () => {
    m.store.orders = [{
      id: 'order-1',
      order_display_id: 'ORD-1',
      customer_id: CUSTOMER_HEADERS['x-user-id'],
      driver_id: 'driver-123',
      status: 'payment_released',
    }];

    const app = buildApp();
    const res = await request(app)
      .post('/api/orders/order-1/ratings')
      .set(CUSTOMER_HEADERS)
      .send({ stars: 6 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('triggers on-chain reputation update when driver has a polygon_wallet_address', async () => {
    awardReputationPointsMock.mockClear();
    m.store.orders = [{
      id: 'order-1',
      order_display_id: 'ORD-1',
      customer_id: CUSTOMER_HEADERS['x-user-id'],
      driver_id: 'driver-123',
      status: 'payment_released',
    }];
    m.store.driver_details = [{
      user_id: 'driver-123',
      polygon_wallet_address: '0xAbCd1234567890abcdef1234567890abcdef1234',
    }];

    const app = buildApp();
    const res = await request(app)
      .post('/api/orders/order-1/ratings')
      .set(CUSTOMER_HEADERS)
      .send({ stars: 4, comment: 'Good job' });

    expect(res.status).toBe(201);
    // Give the fire-and-forget promise a tick to resolve.
    await new Promise(r => setTimeout(r, 0));
    expect(awardReputationPointsMock).toHaveBeenCalledOnce();
    expect(awardReputationPointsMock).toHaveBeenCalledWith(
      '0xAbCd1234567890abcdef1234567890abcdef1234',
      4
    );
  });

  it('skips on-chain update when driver has no polygon_wallet_address', async () => {
    awardReputationPointsMock.mockClear();
    m.store.orders = [{
      id: 'order-1',
      order_display_id: 'ORD-1',
      customer_id: CUSTOMER_HEADERS['x-user-id'],
      driver_id: 'driver-no-wallet',
      status: 'payment_released',
    }];
    m.store.driver_details = [{
      user_id: 'driver-no-wallet',
      polygon_wallet_address: null,
    }];

    const app = buildApp();
    const res = await request(app)
      .post('/api/orders/order-1/ratings')
      .set(CUSTOMER_HEADERS)
      .send({ stars: 3 });

    expect(res.status).toBe(201);
    await new Promise(r => setTimeout(r, 0));
    // Rating saved off-chain; blockchain skipped gracefully.
    expect(awardReputationPointsMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/orders/predict-demand — ML demand prediction', () => {
  beforeEach(() => {
    predictDemandMock.mockReset();
  });

  it('happy path: 200, returns prediction from ML engine', async () => {
    predictDemandMock.mockResolvedValueOnce({
      predicted_demand: 42.5,
      model_version: '1.0.0',
      feature_names: ['hour', 'day_of_week', 'is_weekend', 'temperature', 'precipitation', 'historical_volume', 'nearby_drivers'],
    });

    const app = buildApp();
    const res = await request(app)
      .post('/api/orders/predict-demand')
      .set(CUSTOMER_HEADERS)
      .send({
        hour: 14.5,
        day_of_week: 3,
        temperature: 25,
        precipitation: 0,
        historical_volume: 50,
        nearby_drivers: 15,
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      predicted_demand: 42.5,
      model_version: '1.0.0',
      feature_names: ['hour', 'day_of_week', 'is_weekend', 'temperature', 'precipitation', 'historical_volume', 'nearby_drivers'],
    });
    expect(predictDemandMock).toHaveBeenCalledWith({
      hour: 14.5,
      day_of_week: 3,
      temperature: 25,
      precipitation: 0,
      historical_volume: 50,
      nearby_drivers: 15,
    });
  });

  it('returns 400 for validation failure (invalid inputs)', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/orders/predict-demand')
      .set(CUSTOMER_HEADERS)
      .send({
        hour: 25, // invalid hour (must be 0-23)
        day_of_week: 3,
        temperature: 25,
        precipitation: 0,
        historical_volume: 50,
        nearby_drivers: 15,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('returns 502 Bad Gateway when ML engine throws an error', async () => {
    predictDemandMock.mockRejectedValueOnce(new Error('ML service unavailable'));

    const app = buildApp();
    const res = await request(app)
      .post('/api/orders/predict-demand')
      .set(CUSTOMER_HEADERS)
      .send({
        hour: 14.5,
        day_of_week: 3,
        temperature: 25,
        precipitation: 0,
        historical_volume: 50,
        nearby_drivers: 15,
      });

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('Failed to fetch demand prediction from ML engine.');
    expect(res.body.details).toBe('ML service unavailable');
  });

  it('restricts role to customer or driver (returns 403 for admin)', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/orders/predict-demand')
      .set({
        'x-user-id': '00000000-0000-0000-0000-000000000xyz',
        'x-user-role': 'admin',
        'x-user-name': 'Test Admin',
      })
      .send({
        hour: 14.5,
        day_of_week: 3,
        temperature: 25,
        precipitation: 0,
        historical_volume: 50,
        nearby_drivers: 15,
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden: Insufficient privileges.');
  });

  it('predictDemandLimiter uses user-based rate limiting key generator', async () => {
    const route = orderRouter.stack.find(s => s.route && s.route.path === '/predict-demand');
    expect(route).toBeDefined();

    // The route carries the shared per-user limiter (userLimiter) followed by
    // the endpoint-specific predictDemandLimiter; target the latter.
    const rateLimitLayer = route.route.stack.findLast(
      layer => layer.name === 'rateLimit' || (layer.handle && typeof layer.handle.resetKey === 'function')
    );
    expect(rateLimitLayer).toBeDefined();

    const limiter = rateLimitLayer.handle;
    expect(limiter.getKey).toBeDefined();

    const mockUserVal = 'test-user-rate-limit-123';
    const mockReq = {
      user: { id: mockUserVal },
      ip: '127.0.0.1',
    };
    const mockRes = {
      headersSent: false,
      setHeader: () => {},
      getHeader: () => {},
    };
    let nextCalled = false;
    const next = () => { nextCalled = true; };

    await limiter(mockReq, mockRes, next);
    expect(nextCalled).toBe(true);

    const info = await limiter.getKey(mockUserVal);
    expect(info).toBeDefined();
    expect(info.totalHits).toBe(1);
  });
});

describe('Customer actions: change-drop and cancel endpoints', () => {
  beforeEach(() => {
    // reset store and calls
    m.store.orders = [];
    m.store.order_timeline = [];
    m.calls.length = 0;
    routeEstimateMock.mockReset();
    routeEstimateMock.mockResolvedValue({ distanceKm: 100 });
  });

  it('allows customer to change drop and returns recalculated pricing', async () => {
    m.store.orders.push({
      id: 'order-change-1',
      customer_id: CUSTOMER_HEADERS['x-user-id'],
      order_display_id: 'OD-CHANGE-1',
      pickup_lat: 19.0760,
      pickup_lng: 72.8777,
      drop_lat: 28.7041,
      drop_lng: 77.1025,
      weight_tonnes: 3,
      is_fragile: false,
      is_stackable: true,
      status: 'pending'
    });

    const app = buildApp();

    const res = await request(app)
      .put('/api/orders/OD-CHANGE-1/change-drop')
      .set(CUSTOMER_HEADERS)
      .send({ drop_address: 'New Drop Place', drop_lat: 22.22, drop_lng: 88.88 });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('pricing');
    expect(res.body.pricing).toHaveProperty('total_amount');
    const stored = m.store.orders.find(o => o.id === 'order-change-1');
    expect(stored.drop_address).toBe('New Drop Place');
    expect(stored.drop_lat).toBe(22.22);
    expect(stored.drop_lng).toBe(88.88);
  });

  it('blocks change-drop with 409 when escrow is already funded', async () => {
    m.store.orders.push({
      id: 'order-funded-1',
      customer_id: CUSTOMER_HEADERS['x-user-id'],
      order_display_id: 'OD-FUNDED-1',
      pickup_lat: 19.0760,
      pickup_lng: 72.8777,
      drop_lat: 28.7041,
      drop_lng: 77.1025,
      weight_tonnes: 3,
      status: 'accepted',
      escrow_status: 'funded',
    });

    const app = buildApp();

    const res = await request(app)
      .put('/api/orders/OD-FUNDED-1/change-drop')
      .set(CUSTOMER_HEADERS)
      .send({ drop_address: 'New Drop Place', drop_lat: 22.22, drop_lng: 88.88 });

    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty('error');
    expect(res.body).toHaveProperty('recovery');
  });

  it('allows customer to cancel order and returns cancellation_fee and persists reason', async () => {
    m.store.orders.push({
      id: 'order-cancel-1',
      customer_id: CUSTOMER_HEADERS['x-user-id'],
      order_display_id: 'OD-CANCEL-1',
      status: 'pending',
      cancellation_fee: 500
    });

    const app = buildApp();

    const res = await request(app)
      .post('/api/orders/OD-CANCEL-1/cancel')
      .set(CUSTOMER_HEADERS)
      .send({ reason: 'Change of plans' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('cancellation_fee');
    expect(res.body.cancellation_fee).toBe(500);
    const stored = m.store.orders.find(o => o.id === 'order-cancel-1');
    expect(stored.status).toBe('cancelled');
    expect(stored.cancellation_reason).toBe('Change of plans');
  });

  it('rejects cancel when requester is not the order owner', async () => {
    m.store.orders.push({
      id: 'order-cancel-2',
      customer_id: CUSTOMER_HEADERS['x-user-id'],
      order_display_id: 'OD-CANCEL-2',
      status: 'pending',
      cancellation_fee: 300
    });

    const app = buildApp();

    const res = await request(app)
      .post('/api/orders/OD-CANCEL-2/cancel')
      .set({ 'x-user-id': 'some-other-user', 'x-user-role': 'customer' })
      .send({ reason: 'Not owner' });

    expect(res.status).toBe(403);
  });

  it('rejects change-drop when requester is not the order owner', async () => {
    m.store.orders.push({
      id: 'order-change-2',
      customer_id: CUSTOMER_HEADERS['x-user-id'],
      order_display_id: 'OD-CHANGE-2',
      pickup_lat: 19.0760,
      pickup_lng: 72.8777,
      drop_lat: 28.7041,
      drop_lng: 77.1025,
      weight_tonnes: 3,
      is_fragile: false,
      is_stackable: true,
      status: 'pending'
    });

    const app = buildApp();

    const res = await request(app)
      .put('/api/orders/OD-CHANGE-2/change-drop')
      .set({ 'x-user-id': 'some-other-user', 'x-user-role': 'customer' })
      .send({ drop_address: 'New Drop Place', drop_lat: 22.22, drop_lng: 88.88 });

    expect(res.status).toBe(403);
  });

  it('rejects cancel when order is already delivered', async () => {
    m.store.orders.push({
      id: 'order-cancel-delivered',
      customer_id: CUSTOMER_HEADERS['x-user-id'],
      order_display_id: 'OD-CANCEL-DELIVERED',
      status: 'delivered',
      cancellation_fee: 500
    });

    const app = buildApp();

    const res = await request(app)
      .post('/api/orders/OD-CANCEL-DELIVERED/cancel')
      .set(CUSTOMER_HEADERS)
      .send({ reason: 'delivered' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Order was already cancelled, delivered, or payment released. Cannot cancel.');
  });

  it('rejects cancel when payment is already released', async () => {
    m.store.orders.push({
      id: 'order-cancel-released',
      customer_id: CUSTOMER_HEADERS['x-user-id'],
      order_display_id: 'OD-CANCEL-RELEASED',
      status: 'payment_released',
      cancellation_fee: 500
    });

    const app = buildApp();

    const res = await request(app)
      .post('/api/orders/OD-CANCEL-RELEASED/cancel')
      .set(CUSTOMER_HEADERS)
      .send({ reason: 'payment released' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Order was already cancelled, delivered, or payment released. Cannot cancel.');
  });

  it('returns 400 when route estimate computation fails during change-drop', async () => {
    m.store.orders.push({
      id: 'order-change-fail',
      customer_id: CUSTOMER_HEADERS['x-user-id'],
      order_display_id: 'OD-CHANGE-FAIL',
      pickup_lat: 19.0760,
      pickup_lng: 72.8777,
      drop_lat: 28.7041,
      drop_lng: 77.1025,
      weight_tonnes: 3,
      is_fragile: false,
      is_stackable: true,
      status: 'pending'
    });

    routeEstimateMock.mockRejectedValue(new Error('OSRM service down'));

    const app = buildApp();

    const res = await request(app)
      .put('/api/orders/OD-CHANGE-FAIL/change-drop')
      .set(CUSTOMER_HEADERS)
      .send({ drop_address: 'New Drop Place', drop_lat: 22.22, drop_lng: 88.88 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Unable to compute new pricing for the requested drop.');
    expect(res.body.details).toBe('OSRM service down');
  });

  it('returns 500 when weight_tonnes is missing in DB during change-drop', async () => {
    m.store.orders.push({
      id: 'order-change-no-weight',
      customer_id: CUSTOMER_HEADERS['x-user-id'],
      order_display_id: 'OD-CHANGE-NO-WEIGHT',
      pickup_lat: 19.0760,
      pickup_lng: 72.8777,
      drop_lat: 28.7041,
      drop_lng: 77.1025,
      weight_tonnes: null,
      is_fragile: false,
      is_stackable: true,
      status: 'pending'
    });

    const app = buildApp();

    const res = await request(app)
      .put('/api/orders/OD-CHANGE-NO-WEIGHT/change-drop')
      .set(CUSTOMER_HEADERS)
      .send({ drop_address: 'New Drop Place', drop_lat: 22.22, drop_lng: 88.88 });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Data inconsistency: Order is missing weight_tonnes.');
  });

  it('returns 404 for change-drop with non-existent order_display_id', async () => {
    const app = buildApp();

    const res = await request(app)
      .put('/api/orders/OD-NONEXISTENT/change-drop')
      .set(CUSTOMER_HEADERS)
      .send({ drop_address: 'New Drop Place', drop_lat: 22.22, drop_lng: 88.88 });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Order not found.');
  });

  it('returns 404 for cancel with non-existent order_display_id', async () => {
    const app = buildApp();

    const res = await request(app)
      .post('/api/orders/OD-NONEXISTENT/cancel')
      .set(CUSTOMER_HEADERS)
      .send({ reason: 'Non-existent' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Order not found.');
  });
});
