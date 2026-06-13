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

const { default: deviceRouter } = await import('../../src/routes/deviceRoutes.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/devices', deviceRouter);
  return app;
}

const CUSTOMER_HEADERS = {
  'x-user-id': 'customer-uuid-123',
  'x-user-role': 'customer',
  'x-user-name': 'Test Customer',
};

describe('Device Routes Integration Tests', () => {
  beforeEach(() => {
    process.env.BYPASS_AUTH = 'true';
    process.env.NODE_ENV = 'test';
    m.store.user_devices = [];
    m.calls.length = 0;
  });

  describe('POST /api/devices/register', () => {
    it('returns 401 if x-user-id header is missing when BYPASS_AUTH is enabled', async () => {
      const res = await request(buildApp())
        .post('/api/devices/register')
        .send({ fcmToken: 'token123', platform: 'ios' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Authentication bypassed but x-user-id header is missing.');
    });

    it('successfully registers a device token for an authenticated customer', async () => {
      const res = await request(buildApp())
        .post('/api/devices/register')
        .set(CUSTOMER_HEADERS)
        .send({ fcmToken: 'token123', platform: 'ios' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        message: 'Device token registered',
      });

      // Verify the record was stored in user_devices table
      const stored = m.store.user_devices.find(d => d.user_id === 'customer-uuid-123');
      expect(stored).toBeTruthy();
      expect(stored.fcm_token).toBe('token123');
      expect(stored.platform).toBe('ios');
    });

    it('uses default platform android if platform is not provided', async () => {
      const res = await request(buildApp())
        .post('/api/devices/register')
        .set(CUSTOMER_HEADERS)
        .send({ fcmToken: 'token999' });

      expect(res.status).toBe(200);
      const stored = m.store.user_devices.find(d => d.user_id === 'customer-uuid-123');
      expect(stored).toBeTruthy();
      expect(stored.fcm_token).toBe('token999');
      expect(stored.platform).toBe('android');
    });

    it('returns 400 if fcmToken is missing', async () => {
      const res = await request(buildApp())
        .post('/api/devices/register')
        .set(CUSTOMER_HEADERS)
        .send({ platform: 'android' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('fcmToken is required');
    });

    it('returns 500 if database upsert fails and does not expose internal error details', async () => {
      m.programError('Database connection lost');

      const res = await request(buildApp())
        .post('/api/devices/register')
        .set(CUSTOMER_HEADERS)
        .send({ fcmToken: 'token_err' });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to register device');
    });
  });
});
