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
    m.store.profiles = [];
    m.calls.length = 0;
  });

  describe('POST /api/devices/register', () => {
    it('returns 401 if x-user-id header is missing when BYPASS_AUTH is enabled', async () => {
      const res = await request(buildApp())
        .post('/api/devices/register')
        .send({ fcmToken: 'token1234567890', platform: 'ios' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Authentication bypassed but x-user-id header is missing.');
    });

    it('successfully registers a device token for an authenticated customer', async () => {
      const res = await request(buildApp())
        .post('/api/devices/register')
        .set(CUSTOMER_HEADERS)
        .send({ fcmToken: 'token1234567890', platform: 'ios' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        message: 'Device token registered',
      });

      // Verify the record was stored in user_devices table
      const stored = m.store.user_devices.find(d => d.user_id === 'customer-uuid-123');
      expect(stored).toBeTruthy();
      expect(stored.fcm_token).toBe('token1234567890');
      expect(stored.platform).toBe('ios');
    });

    it('clears a reassigned token from the previous user profile', async () => {
      m.store.user_devices.push({
        user_id: 'previous-user-uuid',
        fcm_token: 'shared-token-123456',
        platform: 'android',
      });
      m.store.profiles.push(
        {
          id: 'previous-user-uuid',
          fcm_token: 'shared-token-123456',
          fcm_token_updated_at: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'customer-uuid-123',
          fcm_token: null,
          fcm_token_updated_at: null,
        }
      );

      const res = await request(buildApp())
        .post('/api/devices/register')
        .set(CUSTOMER_HEADERS)
        .send({ fcmToken: 'shared-token-123456', platform: 'ios' });

      expect(res.status).toBe(200);

      const previousProfile = m.store.profiles.find(p => p.id === 'previous-user-uuid');
      const currentProfile = m.store.profiles.find(p => p.id === 'customer-uuid-123');
      const device = m.store.user_devices.find(d => d.fcm_token === 'shared-token-123456');

      expect(previousProfile.fcm_token).toBeNull();
      expect(currentProfile.fcm_token).toBe('shared-token-123456');
      expect(device.user_id).toBe('customer-uuid-123');
      expect(device.platform).toBe('ios');
    });

    it('uses default platform android if platform is not provided', async () => {
      const res = await request(buildApp())
        .post('/api/devices/register')
        .set(CUSTOMER_HEADERS)
        .send({ fcmToken: 'token9999999999' });

      expect(res.status).toBe(200);
      const stored = m.store.user_devices.find(d => d.user_id === 'customer-uuid-123');
      expect(stored).toBeTruthy();
      expect(stored.fcm_token).toBe('token9999999999');
      expect(stored.platform).toBe('android');
    });

    it('returns 400 if fcmToken is missing', async () => {
      const res = await request(buildApp())
        .post('/api/devices/register')
        .set(CUSTOMER_HEADERS)
        .send({ platform: 'android' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
      expect(res.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'fcmToken' }),
        ])
      );
    });

    it('returns 400 if platform is not one of the allowed values', async () => {
      const res = await request(buildApp())
        .post('/api/devices/register')
        .set(CUSTOMER_HEADERS)
        .send({ fcmToken: 'token1234567890', platform: 'smart-fridge' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
    });

    it('returns 500 if database registration fails and does not expose internal error details', async () => {
      m.programError('Database connection lost');

      const res = await request(buildApp())
        .post('/api/devices/register')
        .set(CUSTOMER_HEADERS)
        .send({ fcmToken: 'token_err_database' });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to register device');
    });

    it('successfully registers multiple devices for the same user', async () => {
      const resA = await request(buildApp())
        .post('/api/devices/register')
        .set(CUSTOMER_HEADERS)
        .send({ fcmToken: 'tokenA123456', platform: 'ios' });
      expect(resA.status).toBe(200);

      const resB = await request(buildApp())
        .post('/api/devices/register')
        .set(CUSTOMER_HEADERS)
        .send({ fcmToken: 'tokenB123456', platform: 'android' });
      expect(resB.status).toBe(200);

      const stored = m.store.user_devices.filter(d => d.user_id === 'customer-uuid-123');
      expect(stored.length).toBe(2);
      expect(stored.map(d => d.fcm_token)).toContain('tokenA123456');
      expect(stored.map(d => d.fcm_token)).toContain('tokenB123456');
    });

    it('enforces rate limits after 10 requests within the window', async () => {
      const app = buildApp();
      const headers = {
        ...CUSTOMER_HEADERS,
        'x-user-id': 'rate-limited-user-uuid',
      };

      // Make 10 successful requests
      for (let i = 0; i < 10; i++) {
        const res = await request(app)
          .post('/api/devices/register')
          .set(headers)
          .send({ fcmToken: `token-${i}-1234567890` });
        expect(res.status).toBe(200);
      }

      // The 11th request should exceed the limit and return 429
      const res = await request(app)
        .post('/api/devices/register')
        .set(headers)
        .send({ fcmToken: 'token-11-1234567890' });

      expect(res.status).toBe(429);
      expect(res.body.error).toBe('Rate limit exceeded');
      expect(res.body.retryAfter).toBe(600);
    });
  });
});
