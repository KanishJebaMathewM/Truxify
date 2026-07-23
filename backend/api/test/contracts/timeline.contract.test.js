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

vi.mock('../../src/sockets/tracker.js', () => ({
  initWebSocketServer: () => ({}),
}));

const { default: orderRouter } = await import('../../src/routes/orderRoutes.js');
import {
  expectContract, expectErrorContract,
  expectServerError, expectForbidden, expectNotFound,
  expectTimelineEntryShape,
} from './helpers/responseMatchers.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/orders', orderRouter);
  return app;
}

const CUSTOMER = {
  'x-user-id': 'customer-123',
  'x-user-role': 'customer',
};

const DRIVER = {
  'x-user-id': 'driver-123',
  'x-user-role': 'driver',
};

describe('GET /api/orders/:id/timeline — timeline contract', () => {
  beforeEach(() => {
    m.store.orders = [];
    m.store.order_timeline = [];
    m.calls.length = 0;
  });

  it('200: returns array of timeline entries with milestone, completed, sort_order', async () => {
    m.store.orders.push({
      id: 'order-tl-1',
      customer_id: CUSTOMER['x-user-id'],
      order_display_id: 'OD-TIMELINE',
    });
    m.store.order_timeline.push(
      { order_display_id: 'OD-TIMELINE', milestone: 'Order Placed', completed: true, sort_order: 10, milestone_time: new Date().toISOString() },
      { order_display_id: 'OD-TIMELINE', milestone: 'Truck Assigned', completed: false, sort_order: 20, milestone_time: null },
    );

    const res = await request(buildApp())
      .get('/api/orders/OD-TIMELINE/timeline')
      .set(CUSTOMER);

    expectContract(res, 200);
    expect(Array.isArray(res.body)).toBe(true);
    if (res.body.length > 0) {
      expectTimelineEntryShape(res.body[0]);
    }
  });

  it('404: not found for non-existent order', async () => {
    const res = await request(buildApp())
      .get('/api/orders/nonexistent/timeline')
      .set(CUSTOMER);

    expectNotFound(res);
  });

  it('403: forbidden for non-owner / non-assigned driver', async () => {
    m.store.orders.push({
      id: 'order-tl-2',
      customer_id: 'someone-else',
      driver_id: null,
      order_display_id: 'OD-OTHER',
    });

    const res = await request(buildApp())
      .get('/api/orders/order-tl-2/timeline')
      .set(CUSTOMER);

    expectForbidden(res);
  });

  it('500: server error on DB failure', async () => {
    m.store.orders.push({
      id: 'order-tl-3',
      customer_id: CUSTOMER['x-user-id'],
      order_display_id: 'OD-ERROR',
    });
    m.programError('db failure');

    const res = await request(buildApp())
      .get('/api/orders/order-tl-3/timeline')
      .set(CUSTOMER);

    expectServerError(res);
  });
});

describe('PUT /api/orders/:id/milestones — milestone update contract', () => {
  beforeEach(() => {
    m.store.orders = [];
    m.store.order_timeline = [];
    m.calls.length = 0;
  });

  it('200: returns message and status on successful milestone update', async () => {
    m.store.orders.push({
      id: 'order-ms-1',
      driver_id: DRIVER['x-user-id'],
      order_display_id: 'OD-MS',
      status: 'truck_assigned',
    });
    m.store.order_timeline.push({
      order_display_id: 'OD-MS',
      milestone: 'Goods Loaded',
      completed: false,
      sort_order: 40,
    });

    const res = await request(buildApp())
      .put('/api/orders/order-ms-1/milestones')
      .set(DRIVER)
      .send({ milestone: 'Goods Loaded' });

    expectContract(res, 200);
    expect(res.body).toHaveProperty('message');
    expect(typeof res.body.message).toBe('string');
    expect(res.body).toHaveProperty('status');
    expect(typeof res.body.status).toBe('string');
  });

  it('400: bad request for Delivered milestone', async () => {
    m.store.orders.push({
      id: 'order-ms-2',
      driver_id: DRIVER['x-user-id'],
      order_display_id: 'OD-DEL-MS',
      status: 'in_transit',
    });

    const res = await request(buildApp())
      .put('/api/orders/order-ms-2/milestones')
      .set(DRIVER)
      .send({ milestone: 'Delivered' });

    expectErrorContract(res, 400);
  });

  it('400: bad request for invalid milestone name', async () => {
    const res = await request(buildApp())
      .put('/api/orders/order-ms-1/milestones')
      .set(DRIVER)
      .send({ milestone: 'Invalid Milestone' });

    expectErrorContract(res, 400);
  });

  it('403: forbidden when driver not assigned', async () => {
    m.store.orders.push({
      id: 'order-ms-3',
      driver_id: 'driver-other',
      order_display_id: 'OD-NOT-MINE',
    });

    const res = await request(buildApp())
      .put('/api/orders/order-ms-3/milestones')
      .set(DRIVER)
      .send({ milestone: 'Goods Loaded' });

    expectForbidden(res);
  });

  it('404: not found when order missing', async () => {
    const res = await request(buildApp())
      .put('/api/orders/nonexistent/milestones')
      .set(DRIVER)
      .send({ milestone: 'Goods Loaded' });

    expectNotFound(res);
  });

  it('409: conflict when milestone already completed', async () => {
    m.store.orders.push({
      id: 'order-ms-4',
      driver_id: DRIVER['x-user-id'],
      order_display_id: 'OD-ALREADY',
      status: 'picked_up',
    });
    m.store.order_timeline.push({
      order_display_id: 'OD-ALREADY',
      milestone: 'Goods Loaded',
      completed: true,
      sort_order: 40,
    });

    const res = await request(buildApp())
      .put('/api/orders/order-ms-4/milestones')
      .set(DRIVER)
      .send({ milestone: 'Goods Loaded' });

    expectErrorContract(res, 409);
  });

  it('422: unprocessable when milestone out of sequence', async () => {
    m.store.orders.push({
      id: 'order-ms-5',
      driver_id: DRIVER['x-user-id'],
      order_display_id: 'OD-OUT-SEQ',
      status: 'truck_assigned',
    });
    m.store.order_timeline.push(
      { order_display_id: 'OD-OUT-SEQ', milestone: 'Order Placed', completed: true, sort_order: 10, milestone_time: new Date().toISOString() },
      { order_display_id: 'OD-OUT-SEQ', milestone: 'Truck Assigned', completed: true, sort_order: 20, milestone_time: new Date().toISOString() },
      { order_display_id: 'OD-OUT-SEQ', milestone: 'En Route to Pickup', completed: false, sort_order: 30 },
      { order_display_id: 'OD-OUT-SEQ', milestone: 'In Transit', completed: false, sort_order: 50 },
    );

    const res = await request(buildApp())
      .put('/api/orders/order-ms-5/milestones')
      .set(DRIVER)
      .send({ milestone: 'In Transit' });

    expectErrorContract(res, 422);
  });

  it('500: server error on DB failure', async () => {
    m.store.orders.push({
      id: 'order-ms-6',
      driver_id: DRIVER['x-user-id'],
      order_display_id: 'OD-ERR-MS',
      status: 'truck_assigned',
    });
    m.programError('db failure');

    const res = await request(buildApp())
      .put('/api/orders/order-ms-6/milestones')
      .set(DRIVER)
      .send({ milestone: 'Goods Loaded' });

    expectServerError(res);
  });
});
