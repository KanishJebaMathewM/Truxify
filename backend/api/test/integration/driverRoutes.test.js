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

const getDriverReputationMock = vi.fn().mockResolvedValue(92);
vi.mock('../../src/services/reputation.js', () => ({
  reputationContract: {},
  awardReputationPoints: vi.fn(),
  getDriverReputation: getDriverReputationMock,
}));


const { default: driverRouter } = await import('../../src/routes/driverRoutes.js');


function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/drivers', driverRouter);
  return app;
}

const DRIVER_HEADERS = {
  'x-user-id': 'driver-1',
  'x-user-role': 'driver',
};

describe('Driver Routes', () => {
  beforeEach(() => {
    m.store.driver_details = [];
    m.store.wallet_transactions = [];
    m.store.earnings_daily = [];
    m.store.trucks = [];
    m.store.orders = [];
    m.calls.length = 0;
  });


  it('GET /stats returns 404 when driver profile does not exist', async () => {
    const app = buildApp();

    const res = await request(app)
      .get('/api/drivers/stats')
      .set(DRIVER_HEADERS);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe(
      'Driver statistics profile not initialized.'
    );
  });

  it('GET /stats returns driver statistics', async () => {
    m.store.driver_details.push({
      user_id: 'driver-1',
      rating: 4.9,
      total_trips: 50,
      completion_rate: 98,
      is_online: true,
      wallet_confirmed: 1000,
      wallet_pending: 100,
      wallet_total: 1100,
      truck_id: null,
    });

    const app = buildApp();

    const res = await request(app)
      .get('/api/drivers/stats')
      .set(DRIVER_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.stats.rating).toBe(4.9);
    expect(res.body.truck).toBe(null);
  });


  it('GET /stats returns truck details when truck assigned', async () => {
    m.store.driver_details.push({
      user_id: 'driver-1',
      rating: 5,
      total_trips: 10,
      completion_rate: 100,
      is_online: true,
      wallet_confirmed: 1000,
      wallet_pending: 0,
      wallet_total: 1000,
      truck_id: 'truck-1',
    });

    m.store.trucks.push({
      id: 'truck-1',
      registration_no: 'TN01AB1234',
    });

    const app = buildApp();

    const res = await request(app)
      .get('/api/drivers/stats')
      .set(DRIVER_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.truck.id).toBe('truck-1');
  });

  it('GET /ltl/optimize-route rejects malformed current coordinates', async () => {
    const res = await request(buildApp())
      .get('/api/drivers/ltl/optimize-route?lat=12abc&lng=77.5946')
      .set(DRIVER_HEADERS);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Valid lat and lng query parameters are required.');
    expect(m.calls.some((call) => call.table === 'orders')).toBe(false);
  });

  it('GET /ltl/optimize-route rejects out-of-range current coordinates', async () => {
    const res = await request(buildApp())
      .get('/api/drivers/ltl/optimize-route?lat=999&lng=77.5946')
      .set(DRIVER_HEADERS);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Valid lat and lng query parameters are required.');
    expect(m.calls.some((call) => call.table === 'orders')).toBe(false);
  });

  it('GET /trips enriches escrow_status from the underlying order', async () => {
    m.store.trips = [{
      trip_display_id: 'TX-ORD-100',
      driver_id: 'driver-1',
      route_label: 'A → B',
      status: 'active',
      trip_date: '2026-08-05',
    }];
    m.store.orders = [{
      order_display_id: 'ORD-100',
      escrow_status: 'funded',
    }];

    const app = buildApp();

    const res = await request(app)
      .get('/api/drivers/trips')
      .set(DRIVER_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body.trips).toHaveLength(1);
    expect(res.body.trips[0].trip_display_id).toBe('TX-ORD-100');
    expect(res.body.trips[0].escrow_status).toBe('funded');
  });

  it('PUT /online rejects invalid status', async () => {
    const app = buildApp();

    const res = await request(app)
      .put('/api/drivers/online')
      .set(DRIVER_HEADERS)
      .send({ is_online: 'yes' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'is_online',
          message: expect.any(String),
        }),
      ])
    );
  });

  it('GET /wallet/history rejects invalid page', async () => {
    const app = buildApp();

    const res = await request(app)
      .get('/api/drivers/wallet/history?page=0')
      .set(DRIVER_HEADERS);

    expect(res.status).toBe(400);
  });

  it('GET /wallet/history rejects invalid limit', async () => {
    const app = buildApp();

    const res = await request(app)
      .get('/api/drivers/wallet/history?limit=200')
      .set(DRIVER_HEADERS);

    expect(res.status).toBe(400);
  });

  it('GET /wallet/history returns transactions', async () => {
    m.store.wallet_transactions.push({
      driver_id: 'driver-1',
      amount: 500,
      created_at: '2026-06-01',
    });

    const app = buildApp();

    const res = await request(app)
      .get('/api/drivers/wallet/history')
      .set(DRIVER_HEADERS);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.transactions)).toBe(true);
  });

  it('GET /earnings/summary returns earnings data', async () => {
    m.store.earnings_daily.push({
      driver_id: 'driver-1',
      day_date: '2026-06-01',
      amount: 5000,
      trip_count: 3,
    });

    const app = buildApp();

    const res = await request(app)
      .get('/api/drivers/earnings/summary')
      .set(DRIVER_HEADERS);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /earnings/summary with days=1 returns only today', async () => {
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    m.store.earnings_daily.push(
      { driver_id: 'driver-1', day_date: yesterday, amount: 1000, trip_count: 1 },
      { driver_id: 'driver-1', day_date: today, amount: 2000, trip_count: 2 }
    );

    const app = buildApp();

    const res = await request(app)
      .get('/api/drivers/earnings/summary?days=1')
      .set(DRIVER_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].day_date).toBe(today);
  });

  it('GET /earnings/summary with days=7 returns at most 7 calendar dates', async () => {
    const today = new Date();
    const dates = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      dates.push(d.toISOString().split('T')[0]);
    }
    const oldDate = new Date(today);
    oldDate.setDate(oldDate.getDate() - 10);
    const oldDateStr = oldDate.toISOString().split('T')[0];

    m.store.earnings_daily.push(
      { driver_id: 'driver-1', day_date: oldDateStr, amount: 500, trip_count: 1 },
      ...dates.map((d, i) => ({ driver_id: 'driver-1', day_date: d, amount: (i + 1) * 100, trip_count: i + 1 }))
    );

    const app = buildApp();

    const res = await request(app)
      .get('/api/drivers/earnings/summary?days=7')
      .set(DRIVER_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(7);
    expect(res.body[0].day_date).toBe(dates[0]);
    expect(res.body[6].day_date).toBe(dates[6]);
  });

  it('GET /earnings/summary rejects invalid days values', async () => {
    const app = buildApp();

    for (const days of ['abc', '0', '-3', '1.5', '366']) {
      const res = await request(app)
        .get(`/api/drivers/earnings/summary?days=${days}`)
        .set(DRIVER_HEADERS);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe(
        'days must be an integer between 1 and 365'
      );
    }
  });

  it('GET /earnings/summary with start_date/end_date returns only that window', async () => {
    m.store.earnings_daily.push(
      { driver_id: 'driver-1', day_date: '2026-05-31', amount: 1000, trip_count: 1 },
      { driver_id: 'driver-1', day_date: '2026-06-01', amount: 2000, trip_count: 2 },
      { driver_id: 'driver-1', day_date: '2026-06-15', amount: 3000, trip_count: 3 },
      { driver_id: 'driver-1', day_date: '2026-07-01', amount: 4000, trip_count: 4 }
    );

    const app = buildApp();

    const res = await request(app)
      .get('/api/drivers/earnings/summary?start_date=2026-06-01&end_date=2026-07-01')
      .set(DRIVER_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].day_date).toBe('2026-06-01');
    expect(res.body[1].day_date).toBe('2026-06-15');
  });

  it('GET /earnings/summary with a historical month window returns that month only', async () => {
    m.store.earnings_daily.push(
      { driver_id: 'driver-1', day_date: '2019-12-31', amount: 100, trip_count: 1 },
      { driver_id: 'driver-1', day_date: '2020-01-10', amount: 2500, trip_count: 2 },
      { driver_id: 'driver-1', day_date: '2020-01-31', amount: 1500, trip_count: 1 },
      { driver_id: 'driver-1', day_date: '2020-02-01', amount: 200, trip_count: 1 }
    );

    const app = buildApp();

    const res = await request(app)
      .get('/api/drivers/earnings/summary?start_date=2020-01-01&end_date=2020-02-01')
      .set(DRIVER_HEADERS);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].day_date).toBe('2020-01-10');
    expect(res.body[1].day_date).toBe('2020-01-31');
  });

  it('GET /earnings/summary rejects malformed or single-sided date ranges', async () => {
    const app = buildApp();

    const badQueries = [
      'start_date=2026-06-01',
      'end_date=2026-07-01',
      'start_date=2026-06-01&end_date=not-a-date',
      'start_date=not-a-date&end_date=2026-07-01',
      'start_date=2026-07-01&end_date=2026-06-01',
    ];

    for (const qs of badQueries) {
      const res = await request(app)
        .get(`/api/drivers/earnings/summary?${qs}`)
        .set(DRIVER_HEADERS);

      expect(res.status).toBe(400);
    }
  });

  it('POST /wallet/withdraw rejects invalid amount', async () => {
    const app = buildApp();

    const res = await request(app)
      .post('/api/drivers/wallet/withdraw')
      .set(DRIVER_HEADERS)
      .send({ amount: 0 });

    expect(res.status).toBe(400);
  });

  it('POST /wallet/withdraw rejects insufficient balance', async () => {
    m.store.driver_details.push({
      user_id: 'driver-1',
      wallet_confirmed: 1000,
    });

    const app = buildApp();

    const res = await request(app)
      .post('/api/drivers/wallet/withdraw')
      .set(DRIVER_HEADERS)
      .send({ amount: 5000 });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Insufficient');
  });

  it('POST /wallet/withdraw succeeds and calls RPC', async () => {
    m.store.driver_details.push({
      user_id: 'driver-1',
      wallet_confirmed: 10000,
    });

    process.env.WITHDRAWAL_PAYOUT_PROVIDER = 'test';
    const app = buildApp();

    const res = await request(app)
      .post('/api/drivers/wallet/withdraw')
      .set(DRIVER_HEADERS)
      .send({ amount: 1000 });

    delete process.env.WITHDRAWAL_PAYOUT_PROVIDER;

    expect(res.status).toBe(200);

    const rpcCall = m.calls.find(
      c => c.rpc === 'withdraw_funds_tx'
    );

    expect(rpcCall).toBeTruthy();
  });

  it('POST /wallet/withdraw fails closed when no payout provider is configured', async () => {
    delete process.env.WITHDRAWAL_PAYOUT_PROVIDER;
    delete process.env.WITHDRAWAL_PAYOUT_WEBHOOK_URL;

    m.store.driver_details.push({
      user_id: 'driver-1',
      wallet_confirmed: 10000,
    });

    const app = buildApp();

    const res = await request(app)
      .post('/api/drivers/wallet/withdraw')
      .set(DRIVER_HEADERS)
      .send({ amount: 1000 });

    expect(res.status).toBe(503);
    expect(res.body.error).toContain('no payout provider');

    const rpcCall = m.calls.find(
      c => c.rpc === 'withdraw_funds_tx'
    );

    expect(rpcCall).toBeFalsy();
  });

  it('PUT /online updates driver status successfully', async () => {
    m.programData({ is_online: true });

    const app = buildApp();

    const res = await request(app)
      .put('/api/drivers/online')
      .set(DRIVER_HEADERS)
      .send({ is_online: true });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('online');
  });

  it('PUT /online returns 500 on DB error', async () => {
    m.programError('update failed');

    const app = buildApp();

    const res = await request(app)
      .put('/api/drivers/online')
      .set(DRIVER_HEADERS)
      .send({ is_online: true });

    expect(res.status).toBe(500);
  });

  it('GET /wallet/history returns 500 on DB error', async () => {
    m.programError('db failure');

    const app = buildApp();

    const res = await request(app)
      .get('/api/drivers/wallet/history')
      .set(DRIVER_HEADERS);

    expect(res.status).toBe(500);
  });

  it('GET /earnings/summary returns 500 on DB error', async () => {
    m.programError('db failure');

    const app = buildApp();

    const res = await request(app)
      .get('/api/drivers/earnings/summary')
      .set(DRIVER_HEADERS);

    expect(res.status).toBe(500);
  });

  it('POST /wallet/withdraw returns 404 when driver profile not found', async () => {
    const app = buildApp();

    const res = await request(app)
      .post('/api/drivers/wallet/withdraw')
      .set(DRIVER_HEADERS)
      .send({ amount: 1000 });

    expect(res.status).toBe(404);
  });

  it('POST /wallet/withdraw returns 400 when RPC fails', async () => {
    m.store.driver_details.push({
      user_id: 'driver-1',
      wallet_confirmed: 10000,
    });

    const originalRpc = m.supabase.rpc.bind(m.supabase);
    m.supabase.rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'Withdrawal failed.' },
    });

    const app = buildApp();

    const res = await request(app)
      .post('/api/drivers/wallet/withdraw')
      .set(DRIVER_HEADERS)
      .send({ amount: 1000 });

    m.supabase.rpc = originalRpc;

    expect(res.status).toBe(400);
  });

  describe('GET /:driverId/reputation', () => {
    const validDriverId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    const validHeaders = {
      'x-user-id': validDriverId,
      'x-user-role': 'driver',
    };

    beforeEach(() => {
      getDriverReputationMock.mockReset();
    });

    it('returns both platform rating and on-chain score when wallet exists and blockchain responds', async () => {
      m.store.driver_details.push({
        user_id: validDriverId,
        rating: 4.8,
        polygon_wallet_address: '0xAbcdef1234567890Abcdef1234567890Abcdef12',
      });

      getDriverReputationMock.mockResolvedValue(92);

      const app = buildApp();
      const res = await request(app)
        .get(`/api/drivers/${validDriverId}/reputation`)
        .set(validHeaders);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        driverId: validDriverId,
        walletAddress: '0xAbcdef1234567890Abcdef1234567890Abcdef12',
        onChainScore: 92,
        supabaseRating: 4.8,
      });
      expect(getDriverReputationMock).toHaveBeenCalledWith('0xAbcdef1234567890Abcdef1234567890Abcdef12');
    });

    it('returns onChainScore null and walletAddress null when driver has no wallet', async () => {
      m.store.driver_details.push({
        user_id: validDriverId,
        rating: 4.8,
        polygon_wallet_address: null,
      });

      const app = buildApp();
      const res = await request(app)
        .get(`/api/drivers/${validDriverId}/reputation`)
        .set(validHeaders);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        driverId: validDriverId,
        walletAddress: null,
        onChainScore: null,
        supabaseRating: 4.8,
      });
      expect(getDriverReputationMock).not.toHaveBeenCalled();
    });

    it('returns onChainScore null and supabase rating when blockchain/contract fails', async () => {
      m.store.driver_details.push({
        user_id: validDriverId,
        rating: 4.8,
        polygon_wallet_address: '0xAbcdef1234567890Abcdef1234567890Abcdef12',
      });

      getDriverReputationMock.mockResolvedValue(null);

      const app = buildApp();
      const res = await request(app)
        .get(`/api/drivers/${validDriverId}/reputation`)
        .set(validHeaders);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        driverId: validDriverId,
        walletAddress: '0xAbcdef1234567890Abcdef1234567890Abcdef12',
        onChainScore: null,
        supabaseRating: 4.8,
      });
      expect(getDriverReputationMock).toHaveBeenCalledWith('0xAbcdef1234567890Abcdef1234567890Abcdef12');
    });

    it('returns 404 if driver profile is not found', async () => {
      const app = buildApp();
      const res = await request(app)
        .get(`/api/drivers/${validDriverId}/reputation`)
        .set(validHeaders);

      expect(res.status).toBe(404);
    });
  });

  describe('GET /bids', () => {
    beforeEach(() => {
      m.store.load_bids = [];
    });

    it('returns the paginated bids response shape consumed by the driver app', async () => {
      m.store.load_bids.push(
        { id: 'bid-1', driver_id: 'driver-1', load_id: 'load-1', bid_amount: 5000, created_at: '2026-01-02T00:00:00.000Z' },
        { id: 'bid-2', driver_id: 'driver-1', load_id: 'load-2', bid_amount: 7500, created_at: '2026-01-01T00:00:00.000Z' },
      );

      const app = buildApp();
      const res = await request(app)
        .get('/api/drivers/bids')
        .set(DRIVER_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        page: 1,
        limit: 10,
        total: 2,
        totalPages: 1,
      });
      expect(Array.isArray(res.body.bids)).toBe(true);
      expect(res.body.bids).toHaveLength(2);
      expect(res.body.bids.map((b) => b.id)).toEqual(['bid-1', 'bid-2']);
    });

    it('only returns bids belonging to the requesting driver', async () => {
      m.store.load_bids.push(
        { id: 'bid-mine', driver_id: 'driver-1', load_id: 'load-1', bid_amount: 5000, created_at: '2026-01-01T00:00:00.000Z' },
        { id: 'bid-other', driver_id: 'driver-2', load_id: 'load-2', bid_amount: 9000, created_at: '2026-01-01T00:00:00.000Z' },
      );

      const app = buildApp();
      const res = await request(app)
        .get('/api/drivers/bids')
        .set(DRIVER_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body.bids.map((b) => b.id)).toEqual(['bid-mine']);
    });
  });

  describe('GET /statement & GET /earnings/report', () => {
    beforeEach(() => {
      m.store.orders = [];
    });

    it('returns empty list and summary when no trips exist', async () => {
      const app = buildApp();
      const res = await request(app)
        .get('/api/drivers/statement')
        .set(DRIVER_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body.summary).toEqual({
        total_trips: 0,
        total_base_freight: 0,
        total_platform_fees: 0,
        total_toll_estimate: 0,
        total_net_earnings: 0
      });
      expect(res.body.trips).toEqual([]);
    });

    it('filters trips and aggregates earnings for the driver on /statement', async () => {
      m.store.orders.push(
        {
          id: 'order-1',
          driver_id: 'driver-1',
          status: 'payment_released',
          pickup_address: 'A',
          drop_address: 'B',
          pickup_date: '2026-06-01',
          base_freight: 10000,
          platform_fee: 500,
          toll_estimate: 1500
        },
        {
          id: 'order-2',
          driver_id: 'driver-1',
          status: 'delivered',
          pickup_address: 'C',
          drop_address: 'D',
          pickup_date: '2026-06-05',
          base_freight: 20000,
          platform_fee: 1000,
          toll_estimate: 2000
        },
        {
          id: 'order-other-driver',
          driver_id: 'other-driver',
          status: 'payment_released',
          pickup_address: 'E',
          drop_address: 'F',
          pickup_date: '2026-06-02',
          base_freight: 15000,
          platform_fee: 750,
          toll_estimate: 1000
        }
      );

      const app = buildApp();
      const res = await request(app)
        .get('/api/drivers/statement?start_date=2026-06-02')
        .set(DRIVER_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body.summary).toEqual({
        total_trips: 1,
        total_base_freight: 20000,
        total_platform_fees: 1000,
        total_toll_estimate: 2000,
        total_net_earnings: 19000
      });
      expect(res.body.trips).toHaveLength(1);
      expect(res.body.trips[0].id).toBe('order-2');
    });

    it('filters trips and aggregates earnings for the driver on /earnings/report', async () => {
      m.store.orders.push(
        {
          id: 'order-1',
          driver_id: 'driver-1',
          status: 'payment_released',
          pickup_address: 'A',
          drop_address: 'B',
          pickup_date: '2026-06-01',
          base_freight: 10000,
          platform_fee: 500,
          toll_estimate: 1500
        },
        {
          id: 'order-2',
          driver_id: 'driver-1',
          status: 'delivered',
          pickup_address: 'C',
          drop_address: 'D',
          pickup_date: '2026-06-05',
          base_freight: 20000,
          platform_fee: 1000,
          toll_estimate: 2000
        }
      );

      const app = buildApp();
      const res = await request(app)
        .get('/api/drivers/earnings/report?start_date=2026-06-02')
        .set(DRIVER_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body.summary).toEqual({
        total_trips: 1,
        total_base_freight: 20000,
        total_platform_fees: 1000,
        total_toll_estimate: 2000,
        total_net_earnings: 19000
      });
      expect(res.body.trips).toHaveLength(1);
      expect(res.body.trips[0].id).toBe('order-2');
    });

    it('returns CSV formatting and security headers when format=csv is passed', async () => {
      m.store.orders.push({
        id: 'order-1',
        driver_id: 'driver-1',
        status: 'delivered',
        pickup_address: '=A1',
        drop_address: 'B',
        pickup_date: '2026-06-01',
        base_freight: 10000,
        platform_fee: 500,
        toll_estimate: 1500
      });

      const app = buildApp();
      const res = await request(app)
        .get('/api/drivers/statement?format=csv')
        .set(DRIVER_HEADERS);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-type']).toContain('charset=utf-8');
      expect(res.headers['content-disposition']).toBe('attachment; filename="statement.csv"');
      expect(res.text).toContain('"order-1"');
      expect(res.text).toContain('"10000"');
      // Verify CSV Formula Injection escaping
      expect(res.text).toContain('"' + "'=A1" + '"');
    });

    it('sorts statement trips by net earnings when sort_by=net_earnings is passed', async () => {
      m.store.orders.push(
        {
          id: 'order-low-earn',
          driver_id: 'driver-1',
          status: 'delivered',
          pickup_address: 'A',
          drop_address: 'B',
          pickup_date: '2026-06-01',
          base_freight: 10000,
          platform_fee: 1000,
          toll_estimate: 0
        },
        {
          id: 'order-high-earn',
          driver_id: 'driver-1',
          status: 'delivered',
          pickup_address: 'C',
          drop_address: 'D',
          pickup_date: '2026-06-05',
          base_freight: 30000,
          platform_fee: 1000,
          toll_estimate: 0
        }
      );

      const app = buildApp();
      const res = await request(app)
        .get('/api/drivers/statement?sort_by=net_earnings')
        .set(DRIVER_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body.trips).toHaveLength(2);
      expect(res.body.trips[0].id).toBe('order-high-earn');
    });

    it('sorts statement trips properly in CSV format when sort_by=net_earnings and format=csv are both passed', async () => {
      m.store.orders.push(
        {
          id: 'order-low-earn',
          driver_id: 'driver-1',
          status: 'delivered',
          pickup_address: 'A',
          drop_address: 'B',
          pickup_date: '2026-06-01',
          base_freight: 10000,
          platform_fee: 1000,
          toll_estimate: 0
        },
        {
          id: 'order-high-earn',
          driver_id: 'driver-1',
          status: 'delivered',
          pickup_address: 'C',
          drop_address: 'D',
          pickup_date: '2026-06-05',
          base_freight: 30000,
          platform_fee: 1000,
          toll_estimate: 0
        }
      );

      const app = buildApp();
      const res = await request(app)
        .get('/api/drivers/statement?sort_by=net_earnings&format=csv')
        .set(DRIVER_HEADERS);

      expect(res.status).toBe(200);
      const lines = res.text.split('\n');
      // lines[0] is headers, lines[1] should be the high-earning order, lines[2] should be low-earning order
      expect(lines[1]).toContain('"order-high-earn"');
      expect(lines[2]).toContain('"order-low-earn"');
    });
  });
});

