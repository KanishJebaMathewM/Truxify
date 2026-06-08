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
});
