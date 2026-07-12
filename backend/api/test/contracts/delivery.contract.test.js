import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import express from 'express';

const { createSupabaseMock } = await vi.importActual('../helpers/supabaseMock.js');
const m = createSupabaseMock();

let mockRedis = null;
let completeTripRpcError = null;

const originalRpc = m.supabase.rpc;
m.supabase.rpc = vi.fn().mockImplementation(async (fnName, args) => {
  if (fnName === 'complete_trip_tx') {
    m.calls.push({ rpc: fnName, args });
    if (completeTripRpcError) {
      const error = completeTripRpcError;
      completeTripRpcError = null;
      return { data: null, error };
    }
    const orderId = args.p_order_id;
    const otp = m.store.delivery_otps.find(record =>
      record.id === args.p_otp_id &&
      record.order_id === orderId &&
      record.verified === false &&
      new Date(record.expires_at) >= new Date()
    );
    if (!otp) {
      return { data: null, error: { message: 'Delivery OTP is invalid, expired, or already verified' } };
    }
    const order = m.store.orders.find(o => o.id === orderId);
    if (order) {
      otp.verified = true;
      otp.verified_at = new Date().toISOString();
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

vi.mock('../../src/config/db.js', () => ({
  supabase: m.supabase,
  firebaseAdmin: null,
  get redisClient() { return mockRedis; },
  mongoDb: null,
}));

vi.mock('../../src/sockets/tracker.js', () => ({
  initWebSocketServer: () => ({}),
}));

const escrowReleaseMock = vi.fn();
vi.mock('../../src/services/escrow.js', async () => {
  const actual = await vi.importActual('../../src/services/escrow.js');
  return {
    ...actual,
    escrowRelease: escrowReleaseMock,
  };
});

const { default: orderRouter } = await import('../../src/routes/orderRoutes.js');
import {
  expectContract, expectErrorContract, expectValidationError,
  expectServerError, expectForbidden, expectNotFound,
} from './helpers/responseMatchers.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/orders', orderRouter);
  return app;
}

const DRIVER = {
  'x-user-id': 'driver-123',
  'x-user-role': 'driver',
};

const CUSTOMER = {
  'x-user-id': 'customer-456',
  'x-user-role': 'customer',
};

describe('POST /api/orders/:id/verify-delivery — delivery verification contract', () => {
  beforeEach(() => {
    m.store.orders = [];
    m.store.order_timeline = [];
    m.store.delivery_otps = [];
    m.calls.length = 0;
    completeTripRpcError = null;
    escrowReleaseMock.mockReset();
    mockRedis = null;
  });

  it('200: returns success message on valid delivery verification', async () => {
    m.store.orders.push({
      id: 'order-dv-1',
      driver_id: DRIVER['x-user-id'],
      order_display_id: 'ORD-DV',
      status: 'arriving',
    });
    m.store.delivery_otps.push({
      id: 'otp-dv-1',
      order_id: 'order-dv-1',
      otp_hash: crypto.createHash('sha256').update('123456').digest('hex'),
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      verified: false,
      created_at: new Date().toISOString(),
    });
    m.store.order_timeline.push({
      order_display_id: 'ORD-DV',
      milestone: 'Delivered',
      completed: false,
    });

    const res = await request(buildApp())
      .post('/api/orders/order-dv-1/verify-delivery')
      .set('X-Idempotency-Key', 'dv-test-1')
      .set(DRIVER)
      .send({ otp: '123456' });

    expectContract(res, 200);
    expect(res.body).toHaveProperty('message');
    expect(typeof res.body.message).toBe('string');
    expect(res.body.message).toMatch(/Delivery verified successfully/i);
  });

  it('202: returns escrow_status and payment_released when escrow update fails', async () => {
    m.store.orders.push({
      id: 'order-dv-2',
      driver_id: DRIVER['x-user-id'],
      order_display_id: 'ORD-DV-202',
      status: 'arriving',
      total_amount: 125000,
      escrow_status: 'funded',
    });
    m.store.delivery_otps.push({
      id: 'otp-dv-2',
      order_id: 'order-dv-2',
      otp_hash: crypto.createHash('sha256').update('123456').digest('hex'),
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      verified: false,
      created_at: new Date().toISOString(),
    });
    m.store.order_timeline.push({
      order_display_id: 'ORD-DV-202',
      milestone: 'Delivered',
      completed: false,
    });

    const originalCompleteTrip = m.supabase.rpc;
    m.supabase.rpc = vi.fn().mockImplementation(async (fnName, args) => {
      if (fnName === 'complete_trip_tx') {
        return { data: null, error: null };
      }
      return originalCompleteTrip(fnName, args);
    });

    const res = await request(buildApp())
      .post('/api/orders/order-dv-2/verify-delivery')
      .set('X-Idempotency-Key', 'dv-test-2')
      .set(DRIVER)
      .send({ otp: '123456' });

    m.supabase.rpc = originalRpc;

    expectContract(res, 202);
    expect(res.body).toHaveProperty('message');
    expect(res.body).toHaveProperty('escrow_status');
    expect(typeof res.body.escrow_status).toBe('string');
    expect(res.body).toHaveProperty('payment_released');
    expect(typeof res.body.payment_released).toBe('boolean');
  });

  it('400: validation error when OTP missing', async () => {
    const res = await request(buildApp())
      .post('/api/orders/order-dv-1/verify-delivery')
      .set('X-Idempotency-Key', 'dv-test-3')
      .set(DRIVER)
      .send({});

    expectValidationError(res);
    const fields = res.body.details.map(d => d.field);
    expect(fields).toContain('otp');
  });

  it('400: invalid OTP returns descriptive error', async () => {
    m.store.orders.push({
      id: 'order-dv-3',
      driver_id: DRIVER['x-user-id'],
      order_display_id: 'ORD-INV-OTP',
      status: 'arriving',
    });
    m.store.delivery_otps.push({
      id: 'otp-dv-3',
      order_id: 'order-dv-3',
      otp_hash: crypto.createHash('sha256').update('123456').digest('hex'),
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      verified: false,
      created_at: new Date().toISOString(),
    });

    const res = await request(buildApp())
      .post('/api/orders/order-dv-3/verify-delivery')
      .set('X-Idempotency-Key', 'dv-test-4')
      .set(DRIVER)
      .send({ otp: '654321' });

    expectErrorContract(res, 400);
    expect(res.body.error).toContain('Invalid OTP');
  });

  it('403: forbidden when driver not assigned', async () => {
    m.store.orders.push({
      id: 'order-dv-4',
      driver_id: 'driver-different',
      order_display_id: 'ORD-NOT-ASSIGNED',
      status: 'arriving',
    });

    const res = await request(buildApp())
      .post('/api/orders/order-dv-4/verify-delivery')
      .set('X-Idempotency-Key', 'dv-test-5')
      .set(DRIVER)
      .send({ otp: '123456' });

    expectForbidden(res);
  });

  it('503: service unavailable when escrow release fails', async () => {
    escrowReleaseMock.mockRejectedValue(new Error('Polygon RPC unavailable'));

    m.store.orders.push({
      id: 'order-dv-5',
      driver_id: DRIVER['x-user-id'],
      order_display_id: 'ORD-ESCROW-FAIL',
      status: 'arriving',
      total_amount: 125000,
      escrow_status: 'funded',
    });
    m.store.delivery_otps.push({
      id: 'otp-dv-5',
      order_id: 'order-dv-5',
      otp_hash: crypto.createHash('sha256').update('123456').digest('hex'),
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      verified: false,
      created_at: new Date().toISOString(),
    });

    const res = await request(buildApp())
      .post('/api/orders/order-dv-5/verify-delivery')
      .set('X-Idempotency-Key', 'dv-test-6')
      .set(DRIVER)
      .send({ otp: '123456' });

    expectErrorContract(res, 503);
    expect(res.body).toHaveProperty('retryable');
    expect(res.body.retryable).toBe(true);
  });

  it('500: server error when complete_trip_tx RPC fails', async () => {
    m.store.orders.push({
      id: 'order-dv-6',
      driver_id: DRIVER['x-user-id'],
      order_display_id: 'ORD-RPC-FAIL',
      status: 'arriving',
    });
    m.store.delivery_otps.push({
      id: 'otp-dv-6',
      order_id: 'order-dv-6',
      otp_hash: crypto.createHash('sha256').update('123456').digest('hex'),
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      verified: false,
      created_at: new Date().toISOString(),
    });

    completeTripRpcError = { message: 'Database temporary failure' };

    const res = await request(buildApp())
      .post('/api/orders/order-dv-6/verify-delivery')
      .set('X-Idempotency-Key', 'dv-test-7')
      .set(DRIVER)
      .send({ otp: '123456' });

    expectServerError(res);
  });
});

describe('POST /api/orders/:id/resend-otp — resend OTP contract', () => {
  beforeEach(() => {
    m.store.orders = [];
    m.store.delivery_otps = [];
    m.calls.length = 0;
  });

  it('200: returns message and expiresInMinutes', async () => {
    m.store.orders.push({
      id: 'order-rotp-1',
      driver_id: DRIVER['x-user-id'],
      customer_id: CUSTOMER['x-user-id'],
      order_display_id: 'ORD-ROTP',
      status: 'arriving',
    });

    const res = await request(buildApp())
      .post('/api/orders/order-rotp-1/resend-otp')
      .set(DRIVER);

    expectContract(res, 200);
    expect(res.body).toHaveProperty('message');
    expect(typeof res.body.message).toBe('string');
    expect(res.body).toHaveProperty('expiresInMinutes');
    expect(typeof res.body.expiresInMinutes).toBe('number');
  });

  it('403: forbidden when driver not assigned', async () => {
    m.store.orders.push({
      id: 'order-rotp-2',
      driver_id: 'driver-different',
      customer_id: CUSTOMER['x-user-id'],
      order_display_id: 'ORD-OTHER-DRIVER',
      status: 'arriving',
    });

    const res = await request(buildApp())
      .post('/api/orders/order-rotp-2/resend-otp')
      .set(DRIVER);

    expectForbidden(res);
  });

  it('404: not found for non-existent order', async () => {
    const res = await request(buildApp())
      .post('/api/orders/nonexistent/resend-otp')
      .set(DRIVER);

    expectNotFound(res);
  });
});
