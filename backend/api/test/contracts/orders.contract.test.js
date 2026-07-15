import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

const { createSupabaseMock } = await vi.importActual('../helpers/supabaseMock.js');
const m = createSupabaseMock();

const routeEstimateMock = vi.fn().mockResolvedValue(null);
const awardReputationPointsMock = vi.fn().mockResolvedValue(undefined);
const escrowReleaseMock = vi.fn();
const submitEscrowRefundMock = vi.fn();
const confirmEscrowRefundMock = vi.fn();
const predictDemandMock = vi.fn();
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

vi.mock('../../src/services/reputation.js', () => ({
  reputationContract: {},
  awardReputationPoints: awardReputationPointsMock,
}));

vi.mock('../../src/services/escrow.js', async () => {
  const actual = await vi.importActual('../../src/services/escrow.js');
  return {
    ...actual,
    escrowRelease: escrowReleaseMock,
    submitEscrowRefund: submitEscrowRefundMock,
    confirmEscrowRefund: confirmEscrowRefundMock,
  };
});

vi.mock('../../src/services/ml.js', () => ({
  predictDemand: predictDemandMock,
  predictPrice: vi.fn().mockResolvedValue(null),
}));

const { default: orderRouter } = await import('../../src/routes/orderRoutes.js');
import {
  expectContract, expectErrorContract, expectValidationError,
  expectServerError, expectForbidden, expectNotFound,
  expectOrderShape, expectPricingShape,
} from './helpers/responseMatchers.js';

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
  'x-user-name': 'Test Driver',
};

const validOrder = {
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

describe('POST /api/orders — create order contract', () => {
  beforeEach(() => {
    m.store.orders = [];
    m.store.order_timeline = [];
    m.store.load_offers = [];
    m.calls.length = 0;
    routeEstimateMock.mockReset();
    routeEstimateMock.mockResolvedValue(null);
  });

  it('201: returns order with id, order_display_id, status, created_at', async () => {
    const res = await request(buildApp())
      .post('/api/orders')
      .set(CUSTOMER)
      .send(validOrder);

    expectContract(res, 201);
    expect(res.body).toHaveProperty('message');
    expect(typeof res.body.message).toBe('string');
    expect(res.body).toHaveProperty('order');
    expectOrderShape(res.body.order);
    expect(res.body.order.status).toBe('pending');
  });

  it('400: validation error on missing required fields', async () => {
    const res = await request(buildApp())
      .post('/api/orders')
      .set(CUSTOMER)
      .send({ pickup_address: '123 St' });

    expectValidationError(res);
  });

  it('400: validation error on client-supplied monetary fields', async () => {
    const res = await request(buildApp())
      .post('/api/orders')
      .set(CUSTOMER)
      .send({ ...validOrder, base_freight: 1, total_amount: 1 });

    expectValidationError(res);
    const fields = res.body.details.map(d => d.field);
    expect(fields).toEqual(
      expect.arrayContaining(['base_freight', 'toll_estimate', 'platform_fee', 'total_amount'])
    );
  });

  it('400: pricing computation failure returns structured error', async () => {
    routeEstimateMock.mockRejectedValue(new Error('Invalid coordinates'));

    const res = await request(buildApp())
      .post('/api/orders')
      .set(CUSTOMER)
      .send({ ...validOrder, pickup_lat: 'invalid' });

    expectErrorContract(res, 400);
    expect(res.body).toHaveProperty('details');
  });

  it('500: server error on database failure', async () => {
    m.programError('insert failed');

    const res = await request(buildApp())
      .post('/api/orders')
      .set(CUSTOMER)
      .send(validOrder);

    expectServerError(res);
    expect(res.body).toHaveProperty('details');
  });
});

describe('GET /api/orders/:id — order details contract', () => {
  beforeEach(() => {
    m.store.orders = [];
    m.store.order_timeline = [];
    m.store.profiles = [];
    m.store.driver_details = [];
    m.calls.length = 0;
  });

  it('200: returns order with timeline array and optional driver', async () => {
    m.store.orders.push({
      id: 'order-1',
      customer_id: CUSTOMER['x-user-id'],
      order_display_id: 'OD-DETAILS',
    });

    const res = await request(buildApp())
      .get('/api/orders/order-1')
      .set(CUSTOMER);

    expectContract(res, 200);
    expect(res.body).toHaveProperty('order');
    expect(res.body).toHaveProperty('timeline');
    expect(Array.isArray(res.body.timeline)).toBe(true);
    expectOrderShape(res.body.order);
    if (res.body.driver !== null) {
      expect(typeof res.body.driver).toBe('object');
    }
  });

  it('200: includes driver profile when driver assigned', async () => {
    m.store.orders.push({
      id: 'order-2',
      customer_id: CUSTOMER['x-user-id'],
      driver_id: 'driver-1',
      order_display_id: 'OD-DRIVER',
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

    const res = await request(buildApp())
      .get('/api/orders/order-2')
      .set(CUSTOMER);

    expectContract(res, 200);
    expect(res.body.driver).not.toBeNull();
    expect(typeof res.body.driver).toBe('object');
    expect(res.body.driver).toHaveProperty('name');
    expect(res.body.driver).toHaveProperty('phone');
    expect(res.body.driver).toHaveProperty('rating');
    expect(res.body.driver).toHaveProperty('trips');
  });

  it('404: not found for non-existent order', async () => {
    const res = await request(buildApp())
      .get('/api/orders/nonexistent')
      .set(CUSTOMER);

    expectNotFound(res);
  });

  it('403: forbidden for non-owner', async () => {
    m.store.orders.push({
      id: 'order-1',
      customer_id: 'someone-else',
      order_display_id: 'OD-OTHER',
    });

    const res = await request(buildApp())
      .get('/api/orders/order-1')
      .set(CUSTOMER);

    expectForbidden(res);
  });

  it('500: server error on DB failure', async () => {
    m.programError('db failure');

    const res = await request(buildApp())
      .get('/api/orders/order-1')
      .set(CUSTOMER);

    expectServerError(res);
  });
});

describe('GET /api/orders/history — order history contract', () => {
  beforeEach(() => {
    m.store.orders = [];
    m.calls.length = 0;
  });

  it('200: returns paginated history with page, limit, total, totalPages', async () => {
    m.store.orders.push({
      id: 'order-1',
      customer_id: CUSTOMER['x-user-id'],
      status: 'pending',
      created_at: '2026-06-01',
    });

    const res = await request(buildApp())
      .get('/api/orders/history')
      .set(CUSTOMER);

    expectContract(res, 200);
    expect(res.body).toHaveProperty('page');
    expect(typeof res.body.page).toBe('number');
    expect(res.body).toHaveProperty('limit');
    expect(typeof res.body.limit).toBe('number');
    expect(res.body).toHaveProperty('total');
    expect(typeof res.body.total).toBe('number');
    expect(res.body).toHaveProperty('totalPages');
    expect(typeof res.body.totalPages).toBe('number');
    expect(res.body).toHaveProperty('history');
    expect(Array.isArray(res.body.history)).toBe(true);
  });

  it('400: validation error on invalid page param', async () => {
    const res = await request(buildApp())
      .get('/api/orders/history?page=0')
      .set(CUSTOMER);

    expectErrorContract(res, 400);
  });

  it('500: server error on DB failure', async () => {
    m.programError('db failure');

    const res = await request(buildApp())
      .get('/api/orders/history')
      .set(CUSTOMER);

    expectServerError(res);
  });
});

describe('POST /api/orders/:id/cancel — cancel order contract', () => {
  beforeEach(() => {
    m.store.orders = [];
    m.store.order_timeline = [];
    m.calls.length = 0;
    submitEscrowRefundMock.mockReset();
    confirmEscrowRefundMock.mockReset();
    mockRedis = null;
  });

  it('200: returns cancellation_fee and order', async () => {
    m.store.orders.push({
      id: 'order-cancel-1',
      customer_id: CUSTOMER['x-user-id'],
      order_display_id: 'OD-CANCEL',
      status: 'pending',
      cancellation_fee: 500,
    });

    const res = await request(buildApp())
      .post('/api/orders/order-cancel-1/cancel')
      .set('X-Idempotency-Key', 'cancel-test-1')
      .set(CUSTOMER)
      .send({ reason: 'Change of plans' });

    expectContract(res, 200);
    expect(res.body).toHaveProperty('message');
    expect(typeof res.body.message).toBe('string');
    expect(res.body).toHaveProperty('cancellation_fee');
    expect(typeof res.body.cancellation_fee).toBe('number');
    expect(res.body).toHaveProperty('order');
  });

  it('404: not found for non-existent order', async () => {
    const res = await request(buildApp())
      .post('/api/orders/nonexistent/cancel')
      .set('X-Idempotency-Key', 'cancel-test-2')
      .set(CUSTOMER)
      .send({ reason: 'Test' });

    expectNotFound(res);
  });

  it('403: forbidden for non-owner', async () => {
    m.store.orders.push({
      id: 'order-cancel-2',
      customer_id: 'someone-else',
      order_display_id: 'OD-OTHER',
      status: 'pending',
    });

    const res = await request(buildApp())
      .post('/api/orders/order-cancel-2/cancel')
      .set('X-Idempotency-Key', 'cancel-test-3')
      .set(CUSTOMER)
      .send({ reason: 'Not mine' });

    expectForbidden(res);
  });

  it('409: conflict when order already delivered', async () => {
    m.store.orders.push({
      id: 'order-cancel-3',
      customer_id: CUSTOMER['x-user-id'],
      order_display_id: 'OD-DELIVERED',
      status: 'delivered',
    });

    const res = await request(buildApp())
      .post('/api/orders/order-cancel-3/cancel')
      .set('X-Idempotency-Key', 'cancel-test-4')
      .set(CUSTOMER)
      .send({ reason: 'Too late' });

    expectErrorContract(res, 409);
  });

  it('202: accepted with escrow_status when refund pending', async () => {
    submitEscrowRefundMock.mockRejectedValue(new Error('Polygon unavailable'));

    m.store.orders.push({
      id: 'order-cancel-4',
      customer_id: CUSTOMER['x-user-id'],
      order_display_id: 'OD-REFUND-FAIL',
      status: 'in_transit',
      escrow_status: 'funded',
      cancellation_fee: 500,
    });

    const res = await request(buildApp())
      .post('/api/orders/order-cancel-4/cancel')
      .set('X-Idempotency-Key', 'cancel-test-5')
      .set(CUSTOMER)
      .send({ reason: 'Refund test' });

    expectContract(res, 202);
    expect(res.body).toHaveProperty('escrow_status');
    expect(typeof res.body.escrow_status).toBe('string');
    expect(res.body).toHaveProperty('retryable');
    expect(typeof res.body.retryable).toBe('boolean');
  });
});

describe('PUT /api/orders/:id/change-drop — change drop contract', () => {
  beforeEach(() => {
    m.store.orders = [];
    m.calls.length = 0;
    routeEstimateMock.mockReset();
    routeEstimateMock.mockResolvedValue({ distanceKm: 100 });
  });

  it('200: returns pricing and updated order', async () => {
    m.store.orders.push({
      id: 'order-change-1',
      customer_id: CUSTOMER['x-user-id'],
      order_display_id: 'OD-CHANGE',
      pickup_lat: 19.0760,
      pickup_lng: 72.8777,
      drop_lat: 28.7041,
      drop_lng: 77.1025,
      weight_tonnes: 3,
      is_fragile: false,
      is_stackable: true,
      status: 'pending',
    });

    const res = await request(buildApp())
      .put('/api/orders/order-change-1/change-drop')
      .set(CUSTOMER)
      .send({ drop_address: 'New Drop', drop_lat: 22.22, drop_lng: 88.88 });

    expectContract(res, 200);
    expect(res.body).toHaveProperty('message');
    expect(typeof res.body.message).toBe('string');
    expect(res.body).toHaveProperty('pricing');
    expectPricingShape(res.body.pricing);
    expect(res.body).toHaveProperty('order');
  });

  it('403: forbidden for non-owner', async () => {
    m.store.orders.push({
      id: 'order-change-2',
      customer_id: 'someone-else',
      order_display_id: 'OD-OTHER',
      pickup_lat: 19.0760,
      pickup_lng: 72.8777,
      drop_lat: 28.7041,
      drop_lng: 77.1025,
      weight_tonnes: 3,
      is_fragile: false,
      is_stackable: true,
      status: 'pending',
    });

    const res = await request(buildApp())
      .put('/api/orders/order-change-2/change-drop')
      .set(CUSTOMER)
      .send({ drop_address: 'New Drop', drop_lat: 22.22, drop_lng: 88.88 });

    expectForbidden(res);
  });

  it('409: conflict when escrow funded', async () => {
    m.store.orders.push({
      id: 'order-change-3',
      customer_id: CUSTOMER['x-user-id'],
      order_display_id: 'OD-FUNDED',
      pickup_lat: 19.0760,
      pickup_lng: 72.8777,
      drop_lat: 28.7041,
      drop_lng: 77.1025,
      weight_tonnes: 3,
      is_fragile: false,
      is_stackable: true,
      status: 'accepted',
      escrow_status: 'funded',
    });

    const res = await request(buildApp())
      .put('/api/orders/order-change-3/change-drop')
      .set(CUSTOMER)
      .send({ drop_address: 'New Drop', drop_lat: 22.22, drop_lng: 88.88 });

    expectErrorContract(res, 409);
    expect(res.body).toHaveProperty('recovery');
    expect(typeof res.body.recovery).toBe('string');
  });

  it('404: not found for non-existent order', async () => {
    const res = await request(buildApp())
      .put('/api/orders/nonexistent/change-drop')
      .set(CUSTOMER)
      .send({ drop_address: 'New Drop', drop_lat: 22.22, drop_lng: 88.88 });

    expectNotFound(res);
  });
});

describe('POST /api/orders/:id/confirm-deposit — confirm deposit contract', () => {
  beforeEach(() => {
    m.store.orders = [];
    m.calls.length = 0;
    mockRedis = null;
  });

  it('200: returns message and txHash', async () => {
    m.store.orders.push({
      id: 'order-deposit-1',
      customer_id: CUSTOMER['x-user-id'],
      order_display_id: 'OD-DEPOSIT',
      escrow_booking_id: 'escrow:OD-DEPOSIT',
      escrow_status: 'funding',
    });

    const { recordDepositTx } = await import('../../src/services/escrow.js');
    recordDepositTx.mockResolvedValue({ txHash: '0x' + 'a'.repeat(64), bookingId: 'escrow:OD-DEPOSIT' });

    const res = await request(buildApp())
      .post('/api/orders/order-deposit-1/confirm-deposit')
      .set(CUSTOMER)
      .send({ txHash: '0x' + 'a'.repeat(64) });

    expectContract(res, 200);
    expect(res.body).toHaveProperty('message');
    expect(typeof res.body.message).toBe('string');
    expect(res.body).toHaveProperty('txHash');
    expect(typeof res.body.txHash).toBe('string');
  });

  it('400: bad request when order not in funding state', async () => {
    m.store.orders.push({
      id: 'order-deposit-2',
      customer_id: CUSTOMER['x-user-id'],
      order_display_id: 'OD-NOT-FUNDING',
      escrow_status: 'pending',
    });

    const res = await request(buildApp())
      .post('/api/orders/order-deposit-2/confirm-deposit')
      .set(CUSTOMER)
      .send({ txHash: '0x' + 'b'.repeat(64) });

    expectErrorContract(res, 400);
  });

  it('404: not found for non-existent order', async () => {
    const res = await request(buildApp())
      .post('/api/orders/nonexistent/confirm-deposit')
      .set(CUSTOMER)
      .send({ txHash: '0x' + 'c'.repeat(64) });

    expectNotFound(res);
  });
});

describe('POST /api/orders/:id/ratings — rating contract', () => {
  beforeEach(() => {
    m.store.orders = [];
    m.store.ratings = [];
    m.calls.length = 0;
    awardReputationPointsMock.mockClear();
  });

  it('201: returns message and rating object', async () => {
    m.store.orders.push({
      id: 'order-rating-1',
      order_display_id: 'ORD-RATING',
      customer_id: CUSTOMER['x-user-id'],
      driver_id: 'driver-1',
      status: 'payment_released',
    });

    const res = await request(buildApp())
      .post('/api/orders/order-rating-1/ratings')
      .set(CUSTOMER)
      .send({ stars: 5, comment: 'Great delivery' });

    expectContract(res, 201);
    expect(res.body).toHaveProperty('message');
    expect(typeof res.body.message).toBe('string');
    expect(res.body).toHaveProperty('rating');
    expect(res.body.rating).toHaveProperty('order_display_id');
    expect(res.body.rating).toHaveProperty('customer_id');
    expect(res.body.rating).toHaveProperty('driver_id');
    expect(res.body.rating).toHaveProperty('stars');
    expect(res.body.rating).toHaveProperty('comment');
  });

  it('400: bad request when order not delivered', async () => {
    m.store.orders.push({
      id: 'order-rating-2',
      order_display_id: 'ORD-ACTIVE',
      customer_id: CUSTOMER['x-user-id'],
      driver_id: 'driver-1',
      status: 'in_transit',
    });

    const res = await request(buildApp())
      .post('/api/orders/order-rating-2/ratings')
      .set(CUSTOMER)
      .send({ stars: 5, comment: 'Too early' });

    expectErrorContract(res, 400);
  });

  it('400: validation error on invalid stars', async () => {
    m.store.orders.push({
      id: 'order-rating-3',
      order_display_id: 'ORD-INVALID',
      customer_id: CUSTOMER['x-user-id'],
      driver_id: 'driver-1',
      status: 'payment_released',
    });

    const res = await request(buildApp())
      .post('/api/orders/order-rating-3/ratings')
      .set(CUSTOMER)
      .send({ stars: 6 });

    expectValidationError(res);
  });

  it('403: forbidden for non-owner', async () => {
    m.store.orders.push({
      id: 'order-rating-4',
      order_display_id: 'ORD-OTHER',
      customer_id: 'someone-else',
      driver_id: 'driver-1',
      status: 'payment_released',
    });

    const res = await request(buildApp())
      .post('/api/orders/order-rating-4/ratings')
      .set(CUSTOMER)
      .send({ stars: 5, comment: 'Not mine' });

    expectForbidden(res);
  });

  it('409: conflict on duplicate rating', async () => {
    m.store.orders.push({
      id: 'order-rating-5',
      order_display_id: 'ORD-DUP',
      customer_id: CUSTOMER['x-user-id'],
      driver_id: 'driver-1',
      status: 'payment_released',
    });
    m.store.ratings.push({
      id: 'rating-1',
      order_display_id: 'ORD-DUP',
      customer_id: CUSTOMER['x-user-id'],
    });

    const res = await request(buildApp())
      .post('/api/orders/order-rating-5/ratings')
      .set(CUSTOMER)
      .send({ stars: 4, comment: 'Duplicate' });

    expectErrorContract(res, 409);
  });
});
