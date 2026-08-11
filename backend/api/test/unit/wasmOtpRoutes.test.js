import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../../../wasm/edge-runtime.js', () => ({
  default: {
    calculateRoute: vi.fn(async () => ({ estimated_price: 100 })),
    processDrivers: vi.fn(async (drivers) => drivers),
    optimizeLoads: vi.fn(async () => [0]),
    calculateETA: vi.fn(async () => 42),
    getFunctionStats: vi.fn(async () => ({ modulesLoaded: 0 })),
  },
}));

import wasmRoutes from '../../../../wasm/routes.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', wasmRoutes);
  return app;
}

const ADMIN_HEADERS = { 'x-user-id': 'admin-1', 'x-user-role': 'admin' };
const CUSTOMER_HEADERS = { 'x-user-id': 'customer-1', 'x-user-role': 'customer' };

describe('wasm edge-runtime routes (issue #9825)', () => {
  beforeEach(() => {
    process.env.BYPASS_AUTH = 'true';
    process.env.ENABLE_TEST_AUTH = 'true';
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    delete process.env.BYPASS_AUTH;
    delete process.env.ENABLE_TEST_AUTH;
    delete process.env.NODE_ENV;
  });

  it('rejects anonymous requests with 401', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/wasm/drivers')
      .send({ drivers: [] });

    expect(res.status).toBe(401);
  });

  it('rejects authenticated non-admin roles with 403', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/wasm/route')
      .set(CUSTOMER_HEADERS)
      .send({ origin: 'A', destination: 'B' });

    expect(res.status).toBe(403);
  });

  it('allows admins to call compute endpoints', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/wasm/eta')
      .set(ADMIN_HEADERS)
      .send({ distance: 100, speed: 40, trafficFactor: 0.1 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBe(42);
  });

  it('rejects oversized drivers arrays with 400', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/wasm/drivers')
      .set(ADMIN_HEADERS)
      .send({ drivers: Array(1001).fill({ speed: 60 }) });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('too large');
  });

  it('rejects oversized loads arrays with 400', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/wasm/optimize')
      .set(ADMIN_HEADERS)
      .send({ loads: Array(1001).fill(10), capacity: 10000 });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('too large');
  });

  it('does not expose a public OTP validation route (issue #6331)', async () => {
    const app = buildApp();

    // The route used to accept inputOTP + correctOTP from the request body
    // and return success whenever the two strings matched. It must no longer
    // exist on the API surface even for an authenticated admin.
    const res = await request(app)
      .post('/api/wasm/otp')
      .set(ADMIN_HEADERS)
      .send({ inputOTP: '123456', correctOTP: '123456' });

    expect(res.status).toBe(404);
    expect(res.body).not.toHaveProperty('success');
  });
});
