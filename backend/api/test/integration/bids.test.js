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
  escrowRelease: vi.fn(),
  escrowRefund: vi.fn(),
}));

const { default: orderRouter } = await import('../../src/routes/orderRoutes.js');
const { buildDepositTx: mockBuildDepositTx, recordDepositTx: mockRecordDepositTx, escrowRefund: mockEscrowRefund } = await import('../../src/services/escrow.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/orders', orderRouter);
  return app;
}

const CUSTOMER = {
  'x-user-id': 'customer-1',
  'x-user-role': 'customer',
};

const DRIVER = {
  'x-user-id': 'driver-1',
  'x-user-role': 'driver',
};

describe('Bid Routes', () => {
  beforeEach(() => {
    m.store.orders = [];
    m.store.load_offers = [];
    m.store.load_bids = [];
    m.store.profiles = [];
    m.store.driver_details = [];
    m.store.trucks = [];
    m.calls.length = 0;
    mockBuildDepositTx.mockReset();
    mockRecordDepositTx.mockReset();
    mockEscrowRefund.mockReset();
  });

  it('POST /:id/bids rejects invalid amount', async () => {
    const app = buildApp();

    const res = await request(app)
      .post('/api/orders/load-1/bids')
      .set(DRIVER)
      .send({ bid_amount: 0 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'bid_amount',
          message: 'Must be greater than 0',
        }),
      ])
    );
  });

  it('POST /:id/bids rejects non-integer bid amounts', async () => {
    const app = buildApp();

    const res = await request(app)
      .post('/api/orders/load-1/bids')
      .set(DRIVER)
      .send({ bid_amount: 100.5 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'bid_amount',
          message: 'Must be a positive integer',
        }),
      ])
    );
  });

  it('POST /:id/bids creates bid', async () => {
    m.store.load_offers.push({
      id: 'load-1',
      status: 'available',
      customer_id: 'customer-1',
    });

    m.store.driver_details.push({
      user_id: 'driver-1',
      truck_id: 'truck-1',
    });

    m.store.trucks.push({
      id: 'truck-1',
    });

    const app = buildApp();

    const res = await request(app)
      .post('/api/orders/load-1/bids')
      .set(DRIVER)
      .send({ bid_amount: 50000 });

    expect(res.status).toBe(201);

    const insert = m.calls.find(
      c => c.table === 'load_bids' && c.mode === 'insert'
    );

    expect(insert).toBeTruthy();
    expect(insert.payload.bid_amount).toBe(50000);
  });

  it('POST /:id/bids blocks drivers from bidding on their own load offer', async () => {
    m.store.load_offers.push({
      id: 'load-1',
      status: 'available',
      customer_id: 'driver-1',
    });

    const app = buildApp();

    const res = await request(app)
      .post('/api/orders/load-1/bids')
      .set(DRIVER)
      .send({ bid_amount: 50000 });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('You cannot bid on your own load offer');
    expect(m.calls.some(c => c.table === 'load_bids' && c.mode === 'insert')).toBe(false);
  });

  it('POST /:id/bids blocks drivers without an assigned truck', async () => {
    m.store.load_offers.push({
      id: 'load-1',
      status: 'available',
      customer_id: 'customer-1',
    });

    m.store.driver_details.push({
      user_id: 'driver-1',
      truck_id: null,
    });

    const app = buildApp();

    const res = await request(app)
      .post('/api/orders/load-1/bids')
      .set(DRIVER)
      .send({ bid_amount: 50000 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('You must assign a valid truck to your profile before bidding on loads');
    expect(m.calls.some(c => c.table === 'load_bids' && c.mode === 'insert')).toBe(false);
  });

  it('POST /:id/bids blocks orphaned truck assignments', async () => {
    m.store.load_offers.push({
      id: 'load-1',
      status: 'available',
      customer_id: 'customer-1',
    });

    m.store.driver_details.push({
      user_id: 'driver-1',
      truck_id: 'missing-truck',
    });

    const app = buildApp();

    const res = await request(app)
      .post('/api/orders/load-1/bids')
      .set(DRIVER)
      .send({ bid_amount: 50000 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Assigned truck record could not be found');
    expect(m.calls.some(c => c.table === 'load_bids' && c.mode === 'insert')).toBe(false);
  });

  it('POST /:id/bids returns 410 when load unavailable', async () => {
    m.store.load_offers.push({
      id: 'load-1',
      status: 'assigned',
    });

    const app = buildApp();

    const res = await request(app)
      .post('/api/orders/load-1/bids')
      .set(DRIVER)
      .send({ bid_amount: 10000 });

    expect(res.status).toBe(410);
  });

  it('GET /:id/bids returns bids', async () => {
    m.store.orders.push({
      id: 'order-1',
      customer_id: 'customer-1',
      order_display_id: 'OD1',
    });

    m.store.load_offers.push({
      id: 'load-1',
      order_display_id: 'OD1',
    });

    m.store.load_bids.push({
      id: 'bid-1',
      load_id: 'load-1',
      driver_id: 'driver-1',
      bid_amount: 50000,
      status: 'pending',
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

    const app = buildApp();

    const res = await request(app)
      .get('/api/orders/order-1/bids')
      .set(CUSTOMER);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(1);
  });

  it('GET /:id/bids denies access to non-owner', async () => {
    m.store.orders.push({
      id: 'order-1',
      customer_id: 'someone-else',
      order_display_id: 'OD1',
    });

    const app = buildApp();

    const res = await request(app)
      .get('/api/orders/order-1/bids')
      .set(CUSTOMER);

    expect(res.status).toBe(403);
  });

  it('POST /:id/bids/:bidId/accept executes RPC', async () => {
    mockBuildDepositTx.mockResolvedValue({ txData: '0xdeadbeef' });

    m.store.orders.push({
      id: 'order-1',
      customer_id: 'customer-1',
      order_display_id: 'OD1',
    });

    m.store.load_offers.push({
      id: 'load-1',
      order_display_id: 'OD1',
      status: 'available',
    });

    m.store.load_bids.push({
      id: 'bid-1',
      load_id: 'load-1',
      driver_id: 'driver-1',
      bid_amount: 50000,
      status: 'pending',
    });

    m.store.profiles.push(
      { id: 'customer-1', full_name: 'Customer One', polygon_wallet_address: '0x1234567890abcdef1234567890abcdef12345678' },
      { id: 'driver-1', full_name: 'Driver One' },
    );

    m.store.driver_details.push({
      user_id: 'driver-1',
      rating: 4.9,
      truck_id: null,
      polygon_wallet_address: '0xAbcdef1234567890Abcdef1234567890Abcdef12',
    });

    const app = buildApp();

    const res = await request(app)
      .post('/api/orders/order-1/bids/bid-1/accept')
      .set(CUSTOMER);

    expect(res.status).toBe(200);

    const rpc = m.calls.find(c => c.rpc === 'accept_bid_tx');

    expect(rpc).toBeTruthy();
    expect(rpc.args.p_bid_id).toBe('bid-1');
  });

  it('POST /:id/bids/:bidId/accept triggers escrow deposit when wallet addresses present', async () => {
    mockBuildDepositTx.mockResolvedValue({ txData: '0xdeadbeef' });

    m.store.orders.push({
      id: 'order-escrow',
      customer_id: 'customer-1',
      order_display_id: 'OD-ESCROW',
    });

    m.store.load_offers.push({
      id: 'load-escrow',
      order_display_id: 'OD-ESCROW',
      status: 'available',
    });

    m.store.load_bids.push({
      id: 'bid-escrow',
      load_id: 'load-escrow',
      driver_id: 'driver-1',
      bid_amount: 50000,
      status: 'pending',
    });

    m.store.profiles.push(
      { id: 'customer-1', full_name: 'Customer One', polygon_wallet_address: '0x1234567890abcdef1234567890abcdef12345678' },
      { id: 'driver-1', full_name: 'Driver One' },
    );

    m.store.driver_details.push({
      user_id: 'driver-1',
      rating: 4.9,
      total_trips: 100,
      completion_rate: 98,
      truck_id: null,
      polygon_wallet_address: '0xAbcdef1234567890Abcdef1234567890Abcdef12',
    });

    const app = buildApp();

    const res = await request(app)
      .post('/api/orders/order-escrow/bids/bid-escrow/accept')
      .set(CUSTOMER);

    expect(res.status).toBe(200);
    expect(res.body.depositTx).toBe('0xdeadbeef');

    expect(mockBuildDepositTx).toHaveBeenCalledWith(
      'OD-ESCROW',
      '0x1234567890abcdef1234567890abcdef12345678',
      '0xAbcdef1234567890Abcdef1234567890Abcdef12',
      expect.any(BigInt),
    );

    let order = m.store.orders.find(o => o.id === 'order-escrow');
    expect(order.escrow_status).toBe('funding');
    expect(order.escrow_booking_id).toBe('escrow:OD-ESCROW');
  });

  it('POST /:id/bids/:bidId/accept returns error when escrow deposit fails before accepting bid', async () => {
    mockBuildDepositTx.mockRejectedValue(new Error('Out of gas'));

    m.store.orders.push({
      id: 'order-escrow-fail',
      customer_id: 'customer-1',
      order_display_id: 'OD-ESCROW-FAIL',
    });

    m.store.load_offers.push({
      id: 'load-escrow-fail',
      order_display_id: 'OD-ESCROW-FAIL',
      status: 'available',
    });

    m.store.load_bids.push({
      id: 'bid-escrow-fail',
      load_id: 'load-escrow-fail',
      driver_id: 'driver-1',
      bid_amount: 50000,
      status: 'pending',
    });

    m.store.profiles.push(
      { id: 'customer-1', full_name: 'Customer One', polygon_wallet_address: '0x1234567890abcdef1234567890abcdef12345678' },
      { id: 'driver-1', full_name: 'Driver One' },
    );

    m.store.driver_details.push({
      user_id: 'driver-1',
      rating: 4.9,
      total_trips: 100,
      completion_rate: 98,
      truck_id: null,
      polygon_wallet_address: '0xAbcdef1234567890Abcdef1234567890Abcdef12',
    });

    const app = buildApp();

    const res = await request(app)
      .post('/api/orders/order-escrow-fail/bids/bid-escrow-fail/accept')
      .set(CUSTOMER);

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: 'Internal Server Error' });

    let order = m.store.orders.find(o => o.id === 'order-escrow-fail');
    expect(order.escrow_status).toBeUndefined();
  });

  it('POST /:id/bids/:bidId/accept returns 500 when RPC fails after buildDepositTx succeeds', async () => {
    mockBuildDepositTx.mockResolvedValue({ txData: '0xdeadbeef' });

    const originalRpc = m.supabase.rpc;
    try {
      m.supabase.rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'accept_bid_tx RPC failed' } });

      m.store.orders.push({
        id: 'order-comp-fail',
        customer_id: 'customer-1',
        order_display_id: 'OD-COMP-FAIL',
      });

      m.store.load_offers.push({
        id: 'load-comp-fail',
        order_display_id: 'OD-COMP-FAIL',
        status: 'available',
      });

      m.store.load_bids.push({
        id: 'bid-comp-fail',
        load_id: 'load-comp-fail',
        driver_id: 'driver-1',
        bid_amount: 50000,
        status: 'pending',
      });

      m.store.profiles.push(
        { id: 'customer-1', full_name: 'Customer One', polygon_wallet_address: '0x1234567890abcdef1234567890abcdef12345678' },
        { id: 'driver-1', full_name: 'Driver One' },
      );

      m.store.driver_details.push({
        user_id: 'driver-1',
        rating: 4.9,
        total_trips: 100,
        completion_rate: 98,
        truck_id: null,
        polygon_wallet_address: '0xAbcdef1234567890Abcdef1234567890Abcdef12',
      });

      const app = buildApp();

      const res = await request(app)
        .post('/api/orders/order-comp-fail/bids/bid-comp-fail/accept')
        .set(CUSTOMER);

      expect(res.status).toBe(500);
      expect(res.body).toMatchObject({
        error: 'Failed to accept bid atomically.',
        details: 'accept_bid_tx RPC failed',
        recovery: 'The pending escrow deposit has been voided. Please try again.'
      });

      expect(mockBuildDepositTx).toHaveBeenCalledWith(
        'OD-COMP-FAIL',
        '0x1234567890abcdef1234567890abcdef12345678',
        '0xAbcdef1234567890Abcdef1234567890Abcdef12',
        expect.any(BigInt)
      );

      let order = m.store.orders.find(o => o.id === 'order-comp-fail');
      expect(order.escrow_status).toBe('funding');
      expect(order.status).toBeUndefined();
    } finally {
      m.supabase.rpc = originalRpc;
    }
  });

  it('POST /:id/bids/:bidId/accept rejects with 422 when customer wallet missing', async () => {
    m.store.orders.push({
      id: 'order-no-cust-wallet',
      customer_id: 'customer-1',
      order_display_id: 'OD-NO-CUST',
    });

    m.store.load_offers.push({
      id: 'load-no-cust',
      order_display_id: 'OD-NO-CUST',
      status: 'available',
    });

    m.store.load_bids.push({
      id: 'bid-no-cust',
      load_id: 'load-no-cust',
      driver_id: 'driver-1',
      bid_amount: 50000,
      status: 'pending',
    });

    m.store.profiles.push(
      { id: 'customer-1', full_name: 'Customer One' },
      { id: 'driver-1', full_name: 'Driver One' },
    );

    m.store.driver_details.push({
      user_id: 'driver-1',
      rating: 4.9,
      total_trips: 100,
      completion_rate: 98,
      truck_id: null,
      polygon_wallet_address: '0xAbcdef1234567890Abcdef1234567890Abcdef12',
    });

    const app = buildApp();

    const res = await request(app)
      .post('/api/orders/order-no-cust-wallet/bids/bid-no-cust/accept')
      .set(CUSTOMER);

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('Both customer and driver must connect a wallet before escrow can be initiated.');
    expect(mockBuildDepositTx).not.toHaveBeenCalled();
  });

  it('POST /:id/bids/:bidId/accept rejects with 422 when driver wallet missing', async () => {
    m.store.orders.push({
      id: 'order-no-driver-wallet',
      customer_id: 'customer-1',
      order_display_id: 'OD-NO-DRIV',
    });

    m.store.load_offers.push({
      id: 'load-no-driv',
      order_display_id: 'OD-NO-DRIV',
      status: 'available',
    });

    m.store.load_bids.push({
      id: 'bid-no-driv',
      load_id: 'load-no-driv',
      driver_id: 'driver-2',
      bid_amount: 50000,
      status: 'pending',
    });

    m.store.profiles.push(
      { id: 'customer-1', full_name: 'Customer One', polygon_wallet_address: '0x1234567890abcdef1234567890abcdef12345678' },
      { id: 'driver-2', full_name: 'Driver Two' },
    );

    m.store.driver_details.push({
      user_id: 'driver-2',
      rating: 4.9,
      total_trips: 100,
      completion_rate: 98,
      truck_id: null,
      polygon_wallet_address: null,
    });

    const app = buildApp();

    const res = await request(app)
      .post('/api/orders/order-no-driver-wallet/bids/bid-no-driv/accept')
      .set(CUSTOMER);

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('Both customer and driver must connect a wallet before escrow can be initiated.');
    expect(mockBuildDepositTx).not.toHaveBeenCalled();
  });

  it('POST /:id/bids/:bidId/accept rejects invalid ownership', async () => {
    m.store.orders.push({
      id: 'order-1',
      customer_id: 'another-customer',
      order_display_id: 'OD1',
    });

    const app = buildApp();

    const res = await request(app)
      .post('/api/orders/order-1/bids/bid-1/accept')
      .set(CUSTOMER);

    expect(res.status).toBe(403);
  });

  it('POST /:id/bids/:bidId/accept returns 500 when load offer is already claimed', async () => {
    m.store.orders.push({
      id: 'order-1',
      customer_id: 'customer-1',
      order_display_id: 'OD1',
      status: 'pending',
    });

    m.store.load_offers.push({
      id: 'load-1',
      order_display_id: 'OD1',
      status: 'available',
    });

    m.store.load_bids.push({
      id: 'bid-1',
      load_id: 'load-1',
      driver_id: 'driver-1',
      bid_amount: 50000,
      status: 'pending',
    });

    m.store.profiles.push(
      { id: 'customer-1', full_name: 'Customer One', polygon_wallet_address: '0xCustomerWallet' },
      { id: 'driver-1', full_name: 'Driver One' },
    );
    m.store.driver_details.push({ user_id: 'driver-1', rating: 4.9, truck_id: null, polygon_wallet_address: '0xDriverWallet' });
    mockBuildDepositTx.mockResolvedValue({ txData: '0xdeadbeef' });

    m.programRpcError('Load offer is no longer available');

    const app = buildApp();
    const res = await request(app)
      .post('/api/orders/order-1/bids/bid-1/accept')
      .set(CUSTOMER);

    expect(res.status).toBe(500);
    expect(res.body.details).toBe('Load offer is no longer available');
    expect(m.calls.find(c => c.rpc === 'accept_bid_tx')).toBeTruthy();
  });

  it('POST /:id/bids/:bidId/accept returns 500 when order is no longer pending', async () => {
    m.store.orders.push({
      id: 'order-1',
      customer_id: 'customer-1',
      order_display_id: 'OD1',
      status: 'pending',
    });

    m.store.load_offers.push({
      id: 'load-1',
      order_display_id: 'OD1',
      status: 'available',
    });

    m.store.load_bids.push({
      id: 'bid-1',
      load_id: 'load-1',
      driver_id: 'driver-1',
      bid_amount: 50000,
      status: 'pending',
    });

    m.store.profiles.push(
      { id: 'customer-1', full_name: 'Customer One', polygon_wallet_address: '0xCustomerWallet' },
      { id: 'driver-1', full_name: 'Driver One' },
    );
    m.store.driver_details.push({ user_id: 'driver-1', rating: 4.9, truck_id: null, polygon_wallet_address: '0xDriverWallet' });
    mockBuildDepositTx.mockResolvedValue({ txData: '0xdeadbeef' });

    m.programRpcError('Order is no longer pending');

    const app = buildApp();
    const res = await request(app).post('/api/orders/order-1/bids/bid-1/accept').set(CUSTOMER);

    expect(res.status).toBe(500);
    expect(res.body.details).toBe('Order is no longer pending');
    expect(m.calls.find(c => c.rpc === 'accept_bid_tx')).toBeTruthy();
  });  

  describe('Confirm Deposit Route', () => {
    it('POST /:id/confirm-deposit rejects unauthenticated request', async () => {
      const app = buildApp();
      const res = await request(app)
        .post('/api/orders/order-1/confirm-deposit')
        .send({ txHash: '0x' + '1'.repeat(64) });
      expect(res.status).toBe(401);
    });

    it('POST /:id/confirm-deposit returns 400 if order is not in funding state', async () => {
      m.store.orders.push({
        id: 'order-1',
        customer_id: 'customer-1',
        order_display_id: 'OD1',
        escrow_status: 'pending',
      });

      const app = buildApp();
      const res = await request(app)
        .post('/api/orders/order-1/confirm-deposit')
        .set(CUSTOMER)
        .send({ txHash: '0x' + '1'.repeat(64) });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Order is not in funding state');
    });

    it('POST /:id/confirm-deposit returns 422 if recordDepositTx fails', async () => {
      m.store.orders.push({
        id: 'order-1',
        customer_id: 'customer-1',
        order_display_id: 'OD1',
        escrow_status: 'funding',
      });

      mockRecordDepositTx.mockResolvedValue({ error: 'Transaction reverted or not found on chain' });

      const app = buildApp();
      const res = await request(app)
        .post('/api/orders/order-1/confirm-deposit')
        .set(CUSTOMER)
        .send({ txHash: '0x' + '1'.repeat(64) });

      expect(res.status).toBe(422);
      expect(res.body.error).toBe('Transaction reverted or not found on chain');
      expect(mockRecordDepositTx).toHaveBeenCalledWith('escrow:OD1', '0x' + '1'.repeat(64));
    });

    it('POST /:id/confirm-deposit succeeds and marks order as funded', async () => {
      m.store.orders.push({
        id: 'order-1',
        customer_id: 'customer-1',
        order_display_id: 'OD1',
        escrow_status: 'funding',
      });

      const expectedTx = '0x' + '1'.repeat(64);
      mockRecordDepositTx.mockResolvedValue({ txHash: expectedTx, bookingId: 'escrow:OD1' });

      const app = buildApp();
      const res = await request(app)
        .post('/api/orders/order-1/confirm-deposit')
        .set(CUSTOMER)
        .send({ txHash: expectedTx });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Escrow deposit confirmed');
      expect(res.body.txHash).toBe(expectedTx);

      const order = m.store.orders.find(o => o.id === 'order-1');
      expect(order.escrow_status).toBe('funded');
      expect(order.deposit_tx_hash).toBe(expectedTx);
      expect(order.escrow_deposited_at).toBeDefined();
    });
  });
});
