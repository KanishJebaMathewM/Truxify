/**
 * POST /api/orders must be routed to the createOrder controller.
 *
 * The route was lost when the order handlers moved into
 * controllers/orderController.js (03fa1829b): `createOrder` stayed imported but
 * nothing mounted it, so every "Book a truck" request from the customer app
 * fell through to a 404.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

const { createSupabaseMock } = await vi.importActual('../helpers/supabaseMock.js');
const m = createSupabaseMock();

vi.mock('../../src/config/db.js', () => ({
  supabase: m.supabase,
  supabaseAdmin: m.supabase,
  createUserClient: () => m.supabase,
  firebaseAdmin: null,
  redisClient: null,
  mongoDb: null,
}));

vi.mock('../../src/sockets/tracker.js', () => ({
  initWebSocketServer: () => ({}),
  broadcastOrderMilestone: vi.fn(),
}));

vi.mock('../../src/services/osrm.js', async () => ({
  ...(await vi.importActual('../../src/services/osrm.js')),
  getRouteEstimate: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/services/ml.js', () => ({
  predictDemand: vi.fn(),
  predictPrice: vi.fn().mockResolvedValue({ estimatedPricePaisa: null }),
  matchEnRouteLoads: vi.fn(),
}));

const { default: orderRouter } = await import('../../src/routes/orderRoutes.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/orders', orderRouter);
  return app;
}

const CUSTOMER = {
  'x-user-id': '00000000-0000-0000-0000-000000000abc',
  'x-user-role': 'customer',
  'x-user-name': 'Test Customer',
};

const DRIVER = {
  'x-user-id': '00000000-0000-0000-0000-000000000def',
  'x-user-role': 'driver',
};

const validOrder = {
  pickup_address: '123 Pickup St, Mumbai',
  pickup_lat: 19.076,
  pickup_lng: 72.8777,
  drop_address: '456 Drop Ave, Delhi',
  drop_lat: 28.7041,
  drop_lng: 77.1025,
  pickup_date: '2099-10-10',
  pickup_time: '09:00',
  goods_type: 'electronics',
  weight_tonnes: 10,
};

describe('POST /api/orders', () => {
  beforeEach(() => {
    m.store.orders = [];
    m.store.order_timeline = [];
    m.store.load_offers = [];
    m.calls.length = 0;
  });

  it('creates the order for a customer: 201 with the order, its timeline and a load offer', async () => {
    const res = await request(buildApp()).post('/api/orders').set(CUSTOMER).send(validOrder);

    expect(res.status).toBe(201);
    expect(res.body.order).toEqual(
      expect.objectContaining({ order_display_id: expect.any(String), status: 'pending' })
    );
    expect(m.store.orders).toHaveLength(1);
    expect(m.store.orders[0].customer_id).toBe(CUSTOMER['x-user-id']);
    expect(m.store.order_timeline.length).toBeGreaterThan(0);
    expect(m.store.load_offers).toHaveLength(1);
  });

  it('rejects client-supplied pricing with a 400 before anything is written', async () => {
    const res = await request(buildApp())
      .post('/api/orders')
      .set(CUSTOMER)
      .send({ ...validOrder, total_amount: 1 });

    expect(res.status).toBe(400);
    expect(res.body.details.map((d) => d.field)).toContain('total_amount');
    expect(m.store.orders).toHaveLength(0);
  });

  it('only lets customers create orders (order:create policy)', async () => {
    const res = await request(buildApp()).post('/api/orders').set(DRIVER).send(validOrder);

    expect(res.status).toBe(403);
    expect(m.store.orders).toHaveLength(0);
  });
});
