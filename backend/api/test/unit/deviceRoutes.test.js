import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

let authAllowed = true;
let rateLimitAllowed = true;
let currentUser = { id: 'u1', role: 'customer' };

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: vi.fn((req, res, next) => {
    if (!authAllowed) {
      return res.status(401).json({ error: 'User not authenticated' });
    }
    req.user = currentUser;
    next();
  }),
  requireRole: vi.fn(() => (_req, _res, next) => next()),
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  deviceLimiter: vi.fn((_req, res, next) => {
    if (!rateLimitAllowed) {
      return res.status(429).json({ error: 'Rate limit exceeded' });
    }
    next();
  }),
  userLimiter: vi.fn((_req, _res, next) => next()),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/controllers/deviceController.js', () => ({
  registerDeviceToken: vi.fn((req, res) =>
    res.status(200).json({ success: true, message: 'Device token registered' })
  ),
  unregisterDeviceToken: vi.fn((req, res) =>
    res.status(200).json({ success: true, message: 'Device token unregistered' })
  ),
  getDevicePlatforms: vi.fn((req, res) =>
    res.status(200).json({ platforms: ['android', 'ios'] })
  ),
  pruneDevices: vi.fn((req, res) =>
    res.status(200).json({ success: true, pruned: 0 })
  ),
}));

import deviceRoutes from '../../src/routes/deviceRoutes.js';
import {
  registerDeviceToken,
  unregisterDeviceToken,
  getDevicePlatforms,
} from '../../src/controllers/deviceController.js';
import { authenticate } from '../../src/middleware/auth.js';
import { deviceLimiter } from '../../src/middleware/rateLimiter.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/devices', deviceRoutes);
  app.use((err, req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
  });
  return app;
}

describe('deviceRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authAllowed = true;
    rateLimitAllowed = true;
    currentUser = { id: 'u1', role: 'customer' };

    registerDeviceToken.mockImplementation((req, res) =>
      res.status(200).json({ success: true, message: 'Device token registered' })
    );
    unregisterDeviceToken.mockImplementation((req, res) =>
      res.status(200).json({ success: true, message: 'Device token unregistered' })
    );
    getDevicePlatforms.mockImplementation((req, res) =>
      res.status(200).json({ platforms: ['android', 'ios'] })
    );
  });

  describe('Authentication Middleware Enforcement', () => {
    it('rejects POST /devices/register with 401 when unauthenticated', async () => {
      authAllowed = false;

      const res = await request(makeApp())
        .post('/devices/register')
        .send({ fcmToken: 'valid-token-12345', platform: 'android' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('User not authenticated');
      expect(registerDeviceToken).not.toHaveBeenCalled();
    });

    it('rejects DELETE /devices/unregister with 401 when unauthenticated', async () => {
      authAllowed = false;

      const res = await request(makeApp())
        .delete('/devices/unregister')
        .send({ fcmToken: 'valid-token-12345' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('User not authenticated');
      expect(unregisterDeviceToken).not.toHaveBeenCalled();
    });

    it('rejects POST /devices/unregister with 401 when unauthenticated', async () => {
      authAllowed = false;

      const res = await request(makeApp())
        .post('/devices/unregister')
        .send({ fcmToken: 'valid-token-12345' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('User not authenticated');
      expect(unregisterDeviceToken).not.toHaveBeenCalled();
    });

    it('rejects GET /devices/platforms with 401 when unauthenticated', async () => {
      authAllowed = false;

      const res = await request(makeApp()).get('/devices/platforms');

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('User not authenticated');
      expect(getDevicePlatforms).not.toHaveBeenCalled();
    });
  });

  describe('Rate Limiter Middleware Enforcement', () => {
    it('returns 429 on POST /devices/register when rate limit is exceeded', async () => {
      rateLimitAllowed = false;

      const res = await request(makeApp())
        .post('/devices/register')
        .send({ fcmToken: 'valid-token-12345', platform: 'android' });

      expect(res.status).toBe(429);
      expect(res.body.error).toBe('Rate limit exceeded');
      expect(registerDeviceToken).not.toHaveBeenCalled();
    });

    it('returns 429 on DELETE /devices/unregister when rate limit is exceeded', async () => {
      rateLimitAllowed = false;

      const res = await request(makeApp())
        .delete('/devices/unregister')
        .send({ fcmToken: 'valid-token-12345' });

      expect(res.status).toBe(429);
      expect(res.body.error).toBe('Rate limit exceeded');
      expect(unregisterDeviceToken).not.toHaveBeenCalled();
    });

    it('returns 429 on POST /devices/unregister when rate limit is exceeded', async () => {
      rateLimitAllowed = false;

      const res = await request(makeApp())
        .post('/devices/unregister')
        .send({ fcmToken: 'valid-token-12345' });

      expect(res.status).toBe(429);
      expect(res.body.error).toBe('Rate limit exceeded');
      expect(unregisterDeviceToken).not.toHaveBeenCalled();
    });
  });

  describe('POST /devices/register (Device Registration)', () => {
    it('registers a device successfully with valid fcmToken and platform', async () => {
      const res = await request(makeApp())
        .post('/devices/register')
        .send({
          fcmToken: 'valid-fcm-token-12345',
          platform: 'ios',
        });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, message: 'Device token registered' });
      expect(registerDeviceToken).toHaveBeenCalledOnce();
    });

    it('defaults platform to android when omitted in request body', async () => {
      let passedBody;
      registerDeviceToken.mockImplementation((req, res) => {
        passedBody = req.body;
        res.status(200).json({ success: true, message: 'Device token registered' });
      });

      const res = await request(makeApp())
        .post('/devices/register')
        .send({
          fcmToken: 'valid-fcm-token-12345',
        });

      expect(res.status).toBe(200);
      expect(passedBody.platform).toBe('android');
    });

    it('accepts valid platforms: android, ios, and web', async () => {
      for (const platform of ['android', 'ios', 'web']) {
        const res = await request(makeApp())
          .post('/devices/register')
          .send({
            fcmToken: 'valid-fcm-token-12345',
            platform,
          });

        expect(res.status).toBe(200);
      }
    });

    it('accepts valid optional deviceId and metadata', async () => {
      let passedBody;
      registerDeviceToken.mockImplementation((req, res) => {
        passedBody = req.body;
        res.status(200).json({ success: true, message: 'Device token registered' });
      });

      const res = await request(makeApp())
        .post('/devices/register')
        .send({
          fcmToken: 'valid-fcm-token-12345',
          platform: 'android',
          deviceId: 'device-uuid-123.45',
          metadata: { appVersion: '2.1.0', osVersion: '14.0' },
        });

      expect(res.status).toBe(200);
      expect(passedBody.deviceId).toBe('device-uuid-123.45');
      expect(passedBody.metadata).toEqual({ appVersion: '2.1.0', osVersion: '14.0' });
    });

    it('returns 400 when request body is missing', async () => {
      const res = await request(makeApp())
        .post('/devices/register')
        .set('Content-Type', 'application/json');

      expect(res.status).toBe(400);
      expect(registerDeviceToken).not.toHaveBeenCalled();
    });

    it('returns 400 validation error when fcmToken is missing', async () => {
      const res = await request(makeApp())
        .post('/devices/register')
        .send({ platform: 'android' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
      expect(res.body.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'fcmToken' })])
      );
      expect(registerDeviceToken).not.toHaveBeenCalled();
    });

    it('returns 400 validation error when fcmToken is shorter than 10 characters', async () => {
      const res = await request(makeApp())
        .post('/devices/register')
        .send({ fcmToken: 'short', platform: 'android' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
      expect(registerDeviceToken).not.toHaveBeenCalled();
    });

    it('returns 400 validation error when platform is invalid', async () => {
      const res = await request(makeApp())
        .post('/devices/register')
        .send({ fcmToken: 'valid-fcm-token-12345', platform: 'smart-watch' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
      expect(registerDeviceToken).not.toHaveBeenCalled();
    });

    it('returns 400 validation error when deviceId is shorter than 3 characters', async () => {
      const res = await request(makeApp())
        .post('/devices/register')
        .send({ fcmToken: 'valid-fcm-token-12345', deviceId: 'ab' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
      expect(registerDeviceToken).not.toHaveBeenCalled();
    });

    it('returns 400 validation error when deviceId contains invalid characters', async () => {
      const res = await request(makeApp())
        .post('/devices/register')
        .send({ fcmToken: 'valid-fcm-token-12345', deviceId: 'invalid device id with spaces!' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
      expect(registerDeviceToken).not.toHaveBeenCalled();
    });

    it('returns 400 validation error when extra unrecognized fields are supplied (strict schema)', async () => {
      const res = await request(makeApp())
        .post('/devices/register')
        .send({
          fcmToken: 'valid-fcm-token-12345',
          platform: 'android',
          unexpectedField: 'malicious-data',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
      expect(registerDeviceToken).not.toHaveBeenCalled();
    });

    it('handles controller error gracefully and returns error status', async () => {
      registerDeviceToken.mockImplementation((req, res, next) => {
        const error = new Error('Database connection failed');
        error.status = 500;
        next(error);
      });

      const res = await request(makeApp())
        .post('/devices/register')
        .send({ fcmToken: 'valid-fcm-token-12345', platform: 'android' });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Database connection failed');
    });
  });

  describe('DELETE /devices/unregister (Device Unregistration)', () => {
    it('unregisters device token successfully with valid fcmToken', async () => {
      const res = await request(makeApp())
        .delete('/devices/unregister')
        .send({ fcmToken: 'valid-fcm-token-12345' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, message: 'Device token unregistered' });
      expect(unregisterDeviceToken).toHaveBeenCalledOnce();
    });

    it('returns 400 validation error when fcmToken is missing on DELETE', async () => {
      const res = await request(makeApp())
        .delete('/devices/unregister')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
      expect(unregisterDeviceToken).not.toHaveBeenCalled();
    });

    it('returns 400 validation error when fcmToken is too short on DELETE', async () => {
      const res = await request(makeApp())
        .delete('/devices/unregister')
        .send({ fcmToken: 'short' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
      expect(unregisterDeviceToken).not.toHaveBeenCalled();
    });

    it('returns 400 validation error when extra properties are provided on DELETE', async () => {
      const res = await request(makeApp())
        .delete('/devices/unregister')
        .send({ fcmToken: 'valid-fcm-token-12345', platform: 'android' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
      expect(unregisterDeviceToken).not.toHaveBeenCalled();
    });

    it('returns 404 when device token is not found during unregistration', async () => {
      unregisterDeviceToken.mockImplementation((req, res) =>
        res.status(404).json({ success: false, error: 'Device token not found' })
      );

      const res = await request(makeApp())
        .delete('/devices/unregister')
        .send({ fcmToken: 'valid-fcm-token-12345' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Device token not found');
    });

    it('handles controller error on DELETE gracefully', async () => {
      unregisterDeviceToken.mockImplementation((req, res, next) => {
        const error = new Error('Database failure');
        error.status = 500;
        next(error);
      });

      const res = await request(makeApp())
        .delete('/devices/unregister')
        .send({ fcmToken: 'valid-fcm-token-12345' });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Database failure');
    });
  });

  describe('POST /devices/unregister (Alternative Unregister Route)', () => {
    it('unregisters device token successfully via POST', async () => {
      const res = await request(makeApp())
        .post('/devices/unregister')
        .send({ fcmToken: 'valid-fcm-token-12345' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, message: 'Device token unregistered' });
      expect(unregisterDeviceToken).toHaveBeenCalledOnce();
    });

    it('returns 400 validation error when fcmToken is missing on POST unregister', async () => {
      const res = await request(makeApp())
        .post('/devices/unregister')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
      expect(unregisterDeviceToken).not.toHaveBeenCalled();
    });

    it('returns 400 validation error when fcmToken is too short on POST unregister', async () => {
      const res = await request(makeApp())
        .post('/devices/unregister')
        .send({ fcmToken: 'short' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
      expect(unregisterDeviceToken).not.toHaveBeenCalled();
    });

    it('returns 404 when device token not found on POST unregister', async () => {
      unregisterDeviceToken.mockImplementation((req, res) =>
        res.status(404).json({ success: false, error: 'Device token not found' })
      );

      const res = await request(makeApp())
        .post('/devices/unregister')
        .send({ fcmToken: 'valid-fcm-token-12345' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Device token not found');
    });
  });

  describe('GET /devices/platforms (Platform Query)', () => {
    it('returns 200 with platform list', async () => {
      getDevicePlatforms.mockImplementation((req, res) =>
        res.status(200).json({ platforms: ['android', 'ios', 'web'] })
      );

      const res = await request(makeApp()).get('/devices/platforms');

      expect(res.status).toBe(200);
      expect(res.body.platforms).toEqual(['android', 'ios', 'web']);
      expect(getDevicePlatforms).toHaveBeenCalledOnce();
    });

    it('returns 200 with empty platforms list when no devices are active', async () => {
      getDevicePlatforms.mockImplementation((req, res) =>
        res.status(200).json({ platforms: [] })
      );

      const res = await request(makeApp()).get('/devices/platforms');

      expect(res.status).toBe(200);
      expect(res.body.platforms).toEqual([]);
    });

    it('handles controller error on GET /devices/platforms gracefully', async () => {
      getDevicePlatforms.mockImplementation((req, res, next) => {
        const error = new Error('Failed to query platforms');
        error.status = 500;
        next(error);
      });

      const res = await request(makeApp()).get('/devices/platforms');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to query platforms');
    });
  });

  describe('HTTP Routing & Method Edge Cases', () => {
    it('returns 404 for unsupported HTTP methods on /register', async () => {
      const resGet = await request(makeApp()).get('/devices/register');
      expect(resGet.status).toBe(404);

      const resPut = await request(makeApp())
        .put('/devices/register')
        .send({ fcmToken: 'valid-fcm-token-12345' });
      expect(resPut.status).toBe(404);
    });

    it('returns 404 for unsupported HTTP methods on /platforms', async () => {
      const resPost = await request(makeApp())
        .post('/devices/platforms')
        .send({});
      expect(resPost.status).toBe(404);

      const resDelete = await request(makeApp()).delete('/devices/platforms');
      expect(resDelete.status).toBe(404);
    });

    it('returns 404 for unmounted subroutes', async () => {
      const res = await request(makeApp()).get('/devices/nonexistent-route');
      expect(res.status).toBe(404);
    });
  });
});
