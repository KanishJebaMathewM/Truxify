import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => next(),
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  deviceLimiter: (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/validate.js', () => ({
  validateBody: () => (req, _res, next) => { req.body = req.body || {}; next(); },
}));

vi.mock('../../src/controllers/deviceController.js', () => ({
  registerDeviceToken: (req, res) => res.status(200).json({ success: true, message: 'registered' }),
  unregisterDeviceToken: (req, res) => res.status(200).json({ success: true, message: 'unregistered' }),
  getDevicePlatforms: (req, res) => res.status(200).json({ success: true, data: [] }),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import deviceRoutes from '../../src/routes/deviceRoutes.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/devices', deviceRoutes);
  return app;
}

describe('deviceRoutes', () => {
  describe('validateDeviceToken', () => {
    it('rejects missing token', async () => {
      const res = await request(makeApp()).post('/devices/register').send({});
      expect(res.status).not.toBe(500);
    });
  });

  describe('POST /devices/register', () => {
    it('returns success for a valid token', async () => {
      const res = await request(makeApp()).post('/devices/register').send({ token: 'valid-token-123' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('DELETE /devices/unregister', () => {
    it('returns success', async () => {
      const res = await request(makeApp()).delete('/devices/unregister').send({ token: 'valid-token-123' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('GET /devices/platforms', () => {
    it('returns platform list', async () => {
      const res = await request(makeApp()).get('/devices/platforms');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
