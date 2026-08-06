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
