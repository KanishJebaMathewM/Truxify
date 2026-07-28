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

vi.mock('../../src/services/escrow.js', () => ({
  buildDepositTx: vi.fn(),
  recordDepositTx: vi.fn(),
  escrowDeposit: vi.fn(),
  escrowRelease: vi.fn(),
  escrowRefund: vi.fn(),
  submitEscrowRefund: vi.fn(),
  confirmEscrowRefund: vi.fn(),
  bookingIdFromUuid: vi.fn((orderId) => `escrow:${orderId}`),
  ESCROW_MATIC_PER_PAISA: 0.01,
}));

vi.mock('../../src/sockets/tracker.js', () => ({
  initWebSocketServer: () => ({}),
}));

const { default: orderRouter } = await import('../../src/routes/orderRoutes.js');
const { buildDepositTx: mockBuildDepositTx, recordDepositTx: mockRecordDepositTx } = await import('../../src/services/escrow.js');

import {
  expectContract, expectErrorContract, expectValidationError,
  expectServerError, expectForbidden, expectNotFound,
  expectBidShape, expectEnrichedBidShape,
} from './helpers/responseMatchers.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/orders', orderRouter);
  return app;
}

const CUSTOMER = {
  'x-user-id': 'customer-1',
  'x-user-role': 'customer',
  'x-dev-access-token': 'test-dev-token-123',
};

const DRIVER = {
  'x-user-id': 'driver-1',
  'x-user-role': 'driver',
  'x-dev-access-token': 'test-dev-token-123',
};

describe('POST /api/orders/:id/bids — submit bid contract', () => {
  beforeEach(() => {
    m.store.load_offers = [];
    m.store.load_bids = [];
    m.store.driver_details = [];
    m.store.trucks = [];
    m.calls.length = 0;
  });

  it('201: returns message and bid object with id, bid_amount', async () => {
    m.store.load_offers.push({
      id: 'load-bid-1',
      status: 'available',
      customer_id: 'customer-other',
    });
    m.store.driver_details.push({
      user_id: DRIVER['x-user-id'],
      truck_id: 'truck-1',
    });
    m.store.trucks.push({
      id: 'truck-1',
    });

    const res = await request(buildApp())
      .post('/api/orders/load-bid-1/bids')
      .set(DRIVER)
      .send({ bid_amount: 50000 });

    expectContract(res, 201);
    expect(res.body).toHaveProperty('message');
    expect(typeof res.body.message).toBe('string');
    expect(res.body).toHaveProperty('bid');
    expectBidShape(res.body.bid);
  });

  it('400: validation error on invalid bid_amount', async () => {
    const res = await request(buildApp())
      .post('/api/orders/load-bid-1/bids')
      .set(DRIVER)
      .send({ bid_amount: 0 });

    expectValidationError(res);
    const fields = res.body.details.map(d => d.field);
    expect(fields).toContain('bid_amount');
  });

  it('403: forbidden when driver bids on own load', async () => {
    m.store.load_offers.push({
      id: 'load-own',
      status: 'available',
      customer_id: DRIVER['x-user-id'],
    });

    const res = await request(buildApp())
      .post('/api/orders/load-own/bids')
      .set(DRIVER)
      .send({ bid_amount: 50000 });

    expectForbidden(res);
  });

  it('404: not found when load offer missing', async () => {
    const res = await request(buildApp())
      .post('/api/orders/nonexistent/bids')
      .set(DRIVER)
      .send({ bid_amount: 50000 });

    expectNotFound(res);
  });

  it('410: gone when load is no longer available', async () => {
    m.store.load_offers.push({
      id: 'load-assigned',
      status: 'assigned',
      customer_id: 'customer-other',
    });

    const res = await request(buildApp())
      .post('/api/orders/load-assigned/bids')
      .set(DRIVER)
      .send({ bid_amount: 50000 });

    expectErrorContract(res, 410);
  });

  it('409: conflict on duplicate pending bid', async () => {
    m.store.load_offers.push({
      id: 'load-dupe',
      status: 'available',
      customer_id: 'customer-other',
    });
    m.store.driver_details.push({
      user_id: DRIVER['x-user-id'],
      truck_id: 'truck-1',
    });
    m.store.trucks.push({
      id: 'truck-1',
    });
    m.store.load_bids.push({
      id: 'existing-bid',
      load_id: 'load-dupe',
      driver_id: DRIVER['x-user-id'],
      bid_amount: 40000,
      status: 'pending',
    });

    const res = await request(buildApp())
      .post('/api/orders/load-dupe/bids')
      .set(DRIVER)
      .send({ bid_amount: 50000 });

    expectErrorContract(res, 409);
  });

  it('500: server error on DB failure', async () => {
    m.programError('db failure');

    const res = await request(buildApp())
      .post('/api/orders/load-bid-1/bids')
      .set(DRIVER)
      .send({ bid_amount: 50000 });

    expectServerError(res);
  });
});

describe('GET /api/orders/:id/bids — view bids contract', () => {
  beforeEach(() => {
    m.store.orders = [];
    m.store.load_offers = [];
    m.store.load_bids = [];
    m.store.profiles = [];
    m.store.driver_details = [];
    m.calls.length = 0;
  });

  it('200: returns array of enriched bids with driver info', async () => {
    m.store.orders.push({
      id: 'order-view-1',
      customer_id: CUSTOMER['x-user-id'],
      order_display_id: 'OD-VIEW',
    });
    m.store.load_offers.push({
      id: 'load-view-1',
      order_display_id: 'OD-VIEW',
    });
    m.store.load_bids.push({
      id: 'bid-view-1',
      load_id: 'load-view-1',
      driver_id: 'driver-1',
      bid_amount: 50000,
      status: 'pending',
      created_at: new Date().toISOString(),
    });
    m.store.profiles.push({
      id: 'driver-1',
      full_name: 'Driver One',
      phone: '9999999999',
    });
    m.store.driver_details.push({
      user_id: 'driver-1',
      rating: 4.9,
      total_trips: 100,
      completion_rate: 98,
      truck_id: null,
    });

    const res = await request(buildApp())
      .get('/api/orders/order-view-1/bids')
      .set(CUSTOMER);

    expectContract(res, 200);
    expect(Array.isArray(res.body)).toBe(true);
    if (res.body.length > 0) {
      expectEnrichedBidShape(res.body[0]);
    }
  });

  it('200: returns empty array when no bids', async () => {
    m.store.orders.push({
      id: 'order-view-2',
      customer_id: CUSTOMER['x-user-id'],
      order_display_id: 'OD-NOBIDS',
    });
    m.store.load_offers.push({
      id: 'load-view-2',
      order_display_id: 'OD-NOBIDS',
    });

    const res = await request(buildApp())
      .get('/api/orders/order-view-2/bids')
      .set(CUSTOMER);

    expectContract(res, 200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(0);
  });

  it('403: forbidden for non-owner', async () => {
    m.store.orders.push({
      id: 'order-view-3',
      customer_id: 'someone-else',
      order_display_id: 'OD-OTHER',
    });

    const res = await request(buildApp())
      .get('/api/orders/order-view-3/bids')
      .set(CUSTOMER);

    expectForbidden(res);
  });

  it('500: server error on DB failure', async () => {
    m.store.orders.push({
      id: 'order-view-4',
      customer_id: CUSTOMER['x-user-id'],
      order_display_id: 'OD-ERROR',
    });
    m.store.load_offers.push({
      id: 'load-view-4',
      order_display_id: 'OD-ERROR',
    });

    const originalFrom = m.supabase.from.bind(m.supabase);
    m.supabase.from = (table) => {
      const builder = originalFrom(table);
      if (table === 'load_bids') {
        builder._exec = async () => ({ data: null, error: { message: 'bids query failed' } });
      }
      return builder;
    };

    const res = await request(buildApp())
      .get('/api/orders/order-view-4/bids')
      .set(CUSTOMER);

    m.supabase.from = originalFrom;
    expectServerError(res);
  });
});

describe('POST /api/orders/:id/bids/:bidId/accept — accept bid contract', () => {
  beforeEach(() => {
    m.store.orders = [];
    m.store.load_offers = [];
    m.store.load_bids = [];
    m.store.profiles = [];
    m.store.driver_details = [];
    m.calls.length = 0;
    mockBuildDepositTx.mockReset();
    mockBuildDepositTx.mockResolvedValue({ to: '0xescrow', data: '0xdeadbeef' });
    mockRecordDepositTx.mockReset();
  });

  it('200: returns depositTx with to and data fields', async () => {
    m.store.orders.push({
      id: 'order-accept-1',
      customer_id: CUSTOMER['x-user-id'],
      order_display_id: 'OD-ACCEPT',
      version: 1,
    });
    m.store.load_offers.push({
      id: 'load-accept-1',
      order_display_id: 'OD-ACCEPT',
      status: 'available',
    });
    m.store.load_bids.push({
      id: 'bid-accept-1',
      load_id: 'load-accept-1',
      driver_id: 'driver-1',
      bid_amount: 50000,
      status: 'pending',
    });
    m.store.profiles.push(
      { id: CUSTOMER['x-user-id'], full_name: 'Customer One', polygon_wallet_address: '0x1234567890abcdef1234567890abcdef12345678' },
      { id: 'driver-1', full_name: 'Driver One' },
    );
    m.store.driver_details.push({
      user_id: 'driver-1',
      rating: 4.9,
      truck_id: null,
      polygon_wallet_address: '0xAbcdef1234567890Abcdef1234567890Abcdef12',
    });

    const res = await request(buildApp())
      .post('/api/orders/order-accept-1/bids/bid-accept-1/accept')
      .set(CUSTOMER);

    expectContract(res, 200);
    expect(res.body).toHaveProperty('depositTx');
    expect(typeof res.body.depositTx).toBe('object');
    expect(res.body.depositTx).toHaveProperty('to');
    expect(typeof res.body.depositTx.to).toBe('string');
    expect(res.body.depositTx).toHaveProperty('data');
    expect(typeof res.body.depositTx.data).toBe('string');
  });

  it('403: forbidden when bid does not belong to order', async () => {
    m.store.orders.push({
      id: 'order-accept-2',
      customer_id: CUSTOMER['x-user-id'],
      order_display_id: 'OD-OTHER',
    });
    m.store.load_offers.push({
      id: 'load-accept-2',
      order_display_id: 'OD-OTHER',
    });
    m.store.load_bids.push({
      id: 'bid-accept-2',
      load_id: 'load-other',
      driver_id: 'driver-1',
      bid_amount: 50000,
      status: 'pending',
    });

    const res = await request(buildApp())
      .post('/api/orders/order-accept-2/bids/bid-accept-2/accept')
      .set(CUSTOMER);

    expectForbidden(res);
  });

  it('404: not found when load offer missing', async () => {
    m.store.orders.push({
      id: 'order-accept-3',
      customer_id: CUSTOMER['x-user-id'],
      order_display_id: 'OD-NOOFFER',
    });
    m.store.load_bids.push({
      id: 'bid-accept-3',
      load_id: 'load-accept-3',
      driver_id: 'driver-1',
      bid_amount: 50000,
      status: 'pending',
    });

    const res = await request(buildApp())
      .post('/api/orders/order-accept-3/bids/bid-accept-3/accept')
      .set(CUSTOMER);

    expectNotFound(res);
  });

  it('422: unprocessable when customer wallet missing', async () => {
    m.store.orders.push({
      id: 'order-accept-4',
      customer_id: CUSTOMER['x-user-id'],
      order_display_id: 'OD-NO-WALLET',
    });
    m.store.load_offers.push({
      id: 'load-accept-4',
      order_display_id: 'OD-NO-WALLET',
      status: 'available',
    });
    m.store.load_bids.push({
      id: 'bid-accept-4',
      load_id: 'load-accept-4',
      driver_id: 'driver-1',
      bid_amount: 50000,
      status: 'pending',
    });
    m.store.profiles.push(
      { id: CUSTOMER['x-user-id'], full_name: 'Customer One' },
      { id: 'driver-1', full_name: 'Driver One' },
    );
    m.store.driver_details.push({
      user_id: 'driver-1',
      rating: 4.9,
      truck_id: null,
      polygon_wallet_address: '0xAbcdef1234567890Abcdef1234567890Abcdef12',
    });

    const res = await request(buildApp())
      .post('/api/orders/order-accept-4/bids/bid-accept-4/accept')
      .set(CUSTOMER);

    expectErrorContract(res, 422);
  });

  it('500: server error when RPC fails', async () => {
    m.store.orders.push({
      id: 'order-accept-5',
      customer_id: CUSTOMER['x-user-id'],
      order_display_id: 'OD-RPC-FAIL',
      version: 1,
    });
    m.store.load_offers.push({
      id: 'load-accept-5',
      order_display_id: 'OD-RPC-FAIL',
      status: 'available',
    });
    m.store.load_bids.push({
      id: 'bid-accept-5',
      load_id: 'load-accept-5',
      driver_id: 'driver-1',
      bid_amount: 50000,
      status: 'pending',
    });
    m.store.profiles.push(
      { id: CUSTOMER['x-user-id'], full_name: 'Customer One', polygon_wallet_address: '0x1234567890abcdef1234567890abcdef12345678' },
      { id: 'driver-1', full_name: 'Driver One' },
    );
    m.store.driver_details.push({
      user_id: 'driver-1',
      rating: 4.9,
      truck_id: null,
      polygon_wallet_address: '0xAbcdef1234567890Abcdef1234567890Abcdef12',
    });

    const originalRpc = m.supabase.rpc;
    m.supabase.rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'accept_bid_tx RPC failed' } });

    const res = await request(buildApp())
      .post('/api/orders/order-accept-5/bids/bid-accept-5/accept')
      .set(CUSTOMER);

    m.supabase.rpc = originalRpc;
    expectServerError(res);
  });
});
