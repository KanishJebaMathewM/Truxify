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

  it('POST /otp/verify accepts the default driver login OTP', async () => {
    const app = buildApp();

    const res = await request(app)
      .post('/api/drivers/otp/verify')
      .send({ phone: '9876543210', otp: '1234' });

    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect(res.body.message).toBe('OTP verified successfully.');
  });

  it('POST /otp/verify rejects invalid OTP', async () => {
    const app = buildApp();

    const res = await request(app)
      .post('/api/drivers/otp/verify')
      .send({ phone: '9876543210', otp: '0000' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid OTP. Please try again.');
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

    const app = buildApp();

    const res = await request(app)
      .post('/api/drivers/wallet/withdraw')
      .set(DRIVER_HEADERS)
      .send({ amount: 1000 });

    expect(res.status).toBe(200);

    const rpcCall = m.calls.find(
      c => c.rpc === 'withdraw_funds_tx'
    );

    expect(rpcCall).toBeTruthy();
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
    beforeEach(() => {
      getDriverReputationMock.mockReset();
    });

    it('returns both platform rating and on-chain score when wallet exists and blockchain responds', async () => {
      m.store.driver_details.push({
        user_id: 'driver-1',
        rating: 4.8,
        polygon_wallet_address: '0xAbcdef1234567890Abcdef1234567890Abcdef12',
      });

      getDriverReputationMock.mockResolvedValue(92);

      const app = buildApp();
      const res = await request(app)
        .get('/api/drivers/driver-1/reputation')
        .set(DRIVER_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        driverId: 'driver-1',
        walletAddress: '0xAbcdef1234567890Abcdef1234567890Abcdef12',
        onChainScore: 92,
        supabaseRating: 4.8,
      });
      expect(getDriverReputationMock).toHaveBeenCalledWith('0xAbcdef1234567890Abcdef1234567890Abcdef12');
    });

    it('returns onChainScore null and walletAddress null when driver has no wallet', async () => {
      m.store.driver_details.push({
        user_id: 'driver-1',
        rating: 4.8,
        polygon_wallet_address: null,
      });

      const app = buildApp();
      const res = await request(app)
        .get('/api/drivers/driver-1/reputation')
        .set(DRIVER_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        driverId: 'driver-1',
        walletAddress: null,
        onChainScore: null,
        supabaseRating: 4.8,
      });
      expect(getDriverReputationMock).not.toHaveBeenCalled();
    });

    it('returns onChainScore null and supabase rating when blockchain/contract fails', async () => {
      m.store.driver_details.push({
        user_id: 'driver-1',
        rating: 4.8,
        polygon_wallet_address: '0xAbcdef1234567890Abcdef1234567890Abcdef12',
      });

      getDriverReputationMock.mockResolvedValue(null);

      const app = buildApp();
      const res = await request(app)
        .get('/api/drivers/driver-1/reputation')
        .set(DRIVER_HEADERS);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        driverId: 'driver-1',
        walletAddress: '0xAbcdef1234567890Abcdef1234567890Abcdef12',
        onChainScore: null,
        supabaseRating: 4.8,
      });
      expect(getDriverReputationMock).toHaveBeenCalledWith('0xAbcdef1234567890Abcdef1234567890Abcdef12');
    });

    it('returns 404 if driver profile is not found', async () => {
      const app = buildApp();
      const res = await request(app)
        .get('/api/drivers/driver-1/reputation')
        .set(DRIVER_HEADERS);

      expect(res.status).toBe(404);
    });
  });
});

