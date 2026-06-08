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

  it('generates and returns OTP when moving to In Transit milestone', async () => {
    m.store.orders = [{
      id: 'order-1',
      driver_id: 'driver-123',
      order_display_id: 'ORD001',
      status: 'picked_up',
      otp_verified: false
    }];
    m.store.order_timeline = [{
      order_display_id: 'ORD001',
      milestone: 'In Transit',
      completed: false
    }];

    const app = buildApp();
    const res = await request(app)
      .put('/api/orders/order-1/milestones')
      .set({
        'x-user-id': 'driver-123',
        'x-user-role': 'driver'
      })
      .send({ milestone: 'In Transit' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('otp');
    expect(res.body.otp).toMatch(/^\d{6}$/); // 6-digit OTP

    const order = m.store.orders.find(o => o.id === 'order-1');
    expect(order.delivery_otp).toBe(res.body.otp);
    expect(order.otp_verified).toBe(false);
    expect(order.otp_generated_at).toBeDefined();
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
      .send({ otp: '654321' }); // Invalid OTP

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid OTP. Please check and try again.');
  });

  it('verifies delivery successfully with correct OTP, updates status and calls RPC', async () => {
    m.store.orders = [{
      id: 'order-1',
      driver_id: 'driver-123',
      order_display_id: 'ORD001',
      delivery_otp: '123456',
      otp_verified: false,
      status: 'in_transit'
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
    expect(order.otp_verified).toBe(true);
    expect(order.status).toBe('payment_released');

    const timeline = m.store.order_timeline.find(t => t.order_display_id === 'ORD001' && t.milestone === 'Delivered');
    expect(timeline.completed).toBe(true);

    const rpcCall = m.calls.find(c => c.rpc === 'complete_trip_tx');
    expect(rpcCall).toBeTruthy();
    expect(rpcCall.args).toEqual({ p_order_id: 'order-1' });
  });
});
