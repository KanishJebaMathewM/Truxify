import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import wasmRoutes from '../../../../wasm/routes.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', wasmRoutes);
  return app;
}

describe('POST /api/wasm/otp (issue #6331)', () => {
  it('cannot be used to validate an OTP with a client-controlled reference value', async () => {
    const app = buildApp();

    // The route used to accept inputOTP + correctOTP from the request body
    // and return success whenever the two strings matched. It must no longer
    // exist on the public API surface.
    const res = await request(app)
      .post('/api/wasm/otp')
      .send({ inputOTP: '123456', correctOTP: '123456' });

    expect(res.status).toBe(404);
    expect(res.body).not.toHaveProperty('success');
  });
});

describe('wasm edge engine (issue #10629)', () => {
  it('never answers 200 {success:true, data:null} for /wasm/eta', async () => {
    const app = buildApp();

    const res = await request(app)
      .post('/api/wasm/eta')
      .send({ distance: 10, speed: 40, trafficFactor: 0.1 });

    // Either the engine produced a genuine numeric ETA, or it reported a
    // failure — but never a 200 success with null data.
    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeTypeOf('number');
    } else {
      expect(res.body.success).toBe(false);
    }
  });

  it('never answers 200 {success:true, data:null} for /wasm/route', async () => {
    const app = buildApp();

    const res = await request(app)
      .post('/api/wasm/route')
      .send({ origin: 'A', destination: 'B', weight: 500, distance: 25 });

    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.success).toBe(true);
      expect(res.body.data).not.toBeNull();
    } else {
      expect(res.body.success).toBe(false);
    }
  });

  it('validates /wasm/eta inputs before invoking the engine', async () => {
    const app = buildApp();

    const res = await request(app)
      .post('/api/wasm/eta')
      .send({ distance: 0, speed: 40 });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

