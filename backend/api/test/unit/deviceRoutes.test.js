import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => { req.user = req.user || { id: 'u1' }; next(); },
  requireRole: () => (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  userLimiter: (_req, _res, next) => next(),
  deviceLimiter: (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/requirePolicy.js', () => ({
  requirePolicy: () => (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/validate.js', () => ({
  validateBody: () => (_req, _res, next) => next(),
  validateParams: () => (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { supabase, supabaseAdmin } = vi.hoisted(() => ({
  supabase: {
    from: vi.fn(),
    storage: vi.fn(),
  },
  supabaseAdmin: {
    from: vi.fn(),
    storage: vi.fn(),
    rpc: vi.fn(),
  },
}));

vi.mock('../../src/config/db.js', () => ({
  supabase,
  supabaseAdmin,
}));

vi.mock('../../src/controllers/deviceController.js', () => ({
  registerDeviceToken: vi.fn(),
  unregisterDeviceToken: vi.fn(),
  getDevicePlatforms: vi.fn(),
}));

import deviceRoutes from '../../src/routes/deviceRoutes.js';
import {
  registerDeviceToken,
  unregisterDeviceToken,
  getDevicePlatforms,
} from '../../src/controllers/deviceController.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/devices', deviceRoutes);
  return app;
}

describe('deviceRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock implementations to pass through by default
    registerDeviceToken.mockImplementation((req, res) => res.json({ success: true }));
    unregisterDeviceToken.mockImplementation((req, res) => res.json({ success: true }));
    getDevicePlatforms.mockImplementation((req, res) => res.json({ platforms: ['android', 'ios'] }));
  });

  describe('POST /devices/register', () => {
    it('dr1: returns 200 when registration succeeds', async () => {
      registerDeviceToken.mockImplementation((req, res) => {
        res.status(200).json({ success: true, message: 'Device registered' });
      });

      const res = await request(makeApp())
        .post('/devices/register')
        .send({
          fcmToken: 'valid-fcm-token-12345',
          platform: 'android',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('dr2: calls registerDeviceToken with correct parameters', async () => {
      registerDeviceToken.mockImplementation((req, res) => {
        expect(req.body.fcmToken).toBe('valid-fcm-token-12345');
        expect(req.body.platform).toBe('ios');
        res.json({ success: true });
      });

      await request(makeApp())
        .post('/devices/register')
        .send({
          fcmToken: 'valid-fcm-token-12345',
          platform: 'ios',
        });
    });

    it('dr3: returns 400 when fcmToken is too short', async () => {
      registerDeviceToken.mockImplementation((req, res) => {
        if (!req.body.fcmToken || req.body.fcmToken.length < 10) {
          return res.status(400).json({ error: 'fcmToken must be at least 10 characters' });
        }
        res.json({ success: true });
      });

      const res = await request(makeApp())
        .post('/devices/register')
        .send({
          fcmToken: 'short',
          platform: 'android',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('10 characters');
    });

    it('dr4: returns 500 when controller throws error', async () => {
      registerDeviceToken.mockImplementation(() => {
        throw new Error('Database error');
      });

      const res = await request(makeApp())
        .post('/devices/register')
        .send({
          fcmToken: 'valid-fcm-token-12345',
          platform: 'android',
        });

      expect(res.status).toBe(500);
    });
  });

  describe('DELETE /devices/unregister', () => {
    it('dr5: returns 200 when unregistration succeeds', async () => {
      unregisterDeviceToken.mockImplementation((req, res) => {
        res.status(200).json({ success: true, message: 'Device unregistered' });
      });

      const res = await request(makeApp())
        .delete('/devices/unregister')
        .send({
          fcmToken: 'valid-fcm-token-12345',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('dr6: returns 400 when fcmToken is missing', async () => {
      unregisterDeviceToken.mockImplementation((req, res) => {
        if (!req.body.fcmToken) {
          return res.status(400).json({ success: false, error: 'fcmToken must be a non-empty string' });
        }
        res.json({ success: true });
      });

      const res = await request(makeApp())
        .delete('/devices/unregister')
        .send({});

      expect(res.status).toBe(400);
    });

    it('dr7: calls unregisterDeviceToken with correct token', async () => {
      const token = 'valid-fcm-token-12345';
      unregisterDeviceToken.mockImplementation((req, res) => {
        expect(req.body.fcmToken).toBe(token);
        res.json({ success: true });
      });

      await request(makeApp())
        .delete('/devices/unregister')
        .send({ fcmToken: token });
    });

    it('dr8: returns 404 when device token not found', async () => {
      unregisterDeviceToken.mockImplementation((req, res) => {
        res.status(404).json({ success: false, error: 'Device token not found' });
      });

      const res = await request(makeApp())
        .delete('/devices/unregister')
        .send({
          fcmToken: 'nonexistent-fcm-token-12345',
        });

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });
  });

  describe('POST /devices/unregister', () => {
    it('dr9: returns 200 when unregistration succeeds via POST', async () => {
      unregisterDeviceToken.mockImplementation((req, res) => {
        res.status(200).json({ success: true, message: 'Device unregistered' });
      });

      const res = await request(makeApp())
        .post('/devices/unregister')
        .send({
          fcmToken: 'valid-fcm-token-12345',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('dr10: returns 400 when fcmToken is too short via POST', async () => {
      unregisterDeviceToken.mockImplementation((req, res) => {
        if (!req.body.fcmToken || req.body.fcmToken.length < 10) {
          return res.status(400).json({ success: false, error: 'fcmToken must be at least 10 characters' });
        }
        res.json({ success: true });
      });

      const res = await request(makeApp())
        .post('/devices/unregister')
        .send({
          fcmToken: 'short',
        });

      expect(res.status).toBe(400);
    });

    it('dr11: handles invalid token characters', async () => {
      unregisterDeviceToken.mockImplementation((req, res) => {
        const token = req.body.fcmToken;
        if (token && !/^[a-zA-Z0-9\-_:.%/+=]+$/.test(token)) {
          return res.status(400).json({ success: false, error: 'fcmToken contains invalid characters' });
        }
        res.json({ success: true });
      });

      const res = await request(makeApp())
        .post('/devices/unregister')
        .send({
          fcmToken: 'invalid@token#$%',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('invalid characters');
    });
  });

  describe('GET /devices/platforms', () => {
    it('dr12: returns 200 with platforms list', async () => {
      getDevicePlatforms.mockImplementation((req, res) => {
        res.status(200).json({ platforms: ['android', 'ios', 'web'] });
      });

      const res = await request(makeApp()).get('/devices/platforms');

      expect(res.status).toBe(200);
      expect(res.body.platforms).toContain('android');
      expect(res.body.platforms).toContain('ios');
    });

    it('dr13: returns empty platforms array when no devices', async () => {
      getDevicePlatforms.mockImplementation((req, res) => {
        res.status(200).json({ platforms: [] });
      });

      const res = await request(makeApp()).get('/devices/platforms');

      expect(res.status).toBe(200);
      expect(res.body.platforms).toHaveLength(0);
    });

    it('dr14: returns 500 when controller throws error', async () => {
      getDevicePlatforms.mockImplementation(() => {
        throw new Error('Database error');
      });

      const res = await request(makeApp()).get('/devices/platforms');

      expect(res.status).toBe(500);
    });

    it('dr15: includes correct platform values', async () => {
      getDevicePlatforms.mockImplementation((req, res) => {
        res.json({ platforms: ['android', 'ios'] });
      });

      const res = await request(makeApp()).get('/devices/platforms');

      expect(res.body.platforms).toContain('android');
      expect(res.body.platforms).toContain('ios');
      expect(res.body.platforms).not.toContain('web');
    });
  });
});
