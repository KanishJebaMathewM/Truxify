import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

const { createSupabaseMock } = await vi.importActual('../helpers/supabaseMock.js');
const m = createSupabaseMock();

vi.mock('../../src/config/db.js', () => ({
  supabase: m.supabase,
  supabaseAdmin: m.supabase,
  firebaseAdmin: null,
  redisClient: null,
  mongoDb: null,
}));

const { default: deviceRouter } = await import('../../src/routes/deviceRoutes.js');
const { errorHandler } = await import('../../src/middleware/errorHandler.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/devices', deviceRouter);
  app.use(errorHandler);
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

    it('returns 500 when the transactional device registration fails', async () => {
      m.programRpcError('Profile write failed');

      const res = await request(buildApp())
        .post('/api/devices/register')
        .set(CUSTOMER_HEADERS)
        .send({ fcmToken: 'token_profile_sync_fail', platform: 'android' });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to register device');
      // The whole registration (device row + profile sync) is one transaction,
      // so a failure must not leave a partially-inserted device row behind.
      expect(m.store.user_devices.find(d => d.fcm_token === 'token_profile_sync_fail')).toBeUndefined();
    });

    it('rotates the device row in place when the same deviceId re-registers with a new token', async () => {
      const ROTATE_HEADERS = {
        'x-user-id': 'rotate-user-uuid-999',
        'x-user-role': 'customer',
        'x-user-name': 'Rotation Customer',
      };

      await request(buildApp())
        .post('/api/devices/register')
        .set(ROTATE_HEADERS)
        .send({ fcmToken: 'old-token-123456', platform: 'android', deviceId: 'device-abc-1' });

      const res = await request(buildApp())
        .post('/api/devices/register')
        .set(ROTATE_HEADERS)
        .send({ fcmToken: 'new-token-123456', platform: 'android', deviceId: 'device-abc-1' });

      expect(res.status).toBe(200);
      const rows = m.store.user_devices.filter(d => d.user_id === 'rotate-user-uuid-999');
      // Old token retired, new token active, no duplicate rows.
      const oldRow = rows.find(d => d.fcm_token === 'old-token-123456');
      const newRow = rows.find(d => d.fcm_token === 'new-token-123456');
      expect(oldRow.is_active).toBe(false);
      expect(newRow).toBeTruthy();
      expect(newRow.is_active).toBe(true);
      expect(newRow.device_id).toBe('device-abc-1');
      expect(rows.filter(d => d.is_active !== false)).toHaveLength(1);
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

  describe('DELETE /api/devices/unregister', () => {
    const UNREGISTER_HEADERS = {
      'x-user-id': 'unregister-test-user-uuid',
      'x-user-role': 'customer',
      'x-user-name': 'Test Customer',
    };

    it('returns 401 if x-user-id header is missing when BYPASS_AUTH is enabled', async () => {
      const res = await request(buildApp())
        .delete('/api/devices/unregister')
        .send({ fcmToken: 'token1234567890' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Authentication bypassed but x-user-id header is missing.');
    });

    it('returns 400 if fcmToken is missing', async () => {
      const res = await request(buildApp())
        .delete('/api/devices/unregister')
        .set(UNREGISTER_HEADERS)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
      expect(res.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'fcmToken' }),
        ])
      );
    });

    it('soft-deactivates the device row and clears the matching profile token', async () => {
      m.store.user_devices.push({
        user_id: 'unregister-test-user-uuid',
        fcm_token: 'logout-token-123456',
        platform: 'android',
        is_active: true,
      });
      m.store.profiles.push({
        id: 'unregister-test-user-uuid',
        fcm_token: 'logout-token-123456',
        fcm_token_updated_at: '2026-01-01T00:00:00.000Z',
      });

      const res = await request(buildApp())
        .delete('/api/devices/unregister')
        .set(UNREGISTER_HEADERS)
        .send({ fcmToken: 'logout-token-123456' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        message: 'Device token unregistered',
      });

      // The row is preserved for audit but deactivated; it must no longer be
      // a fan-out target.
      const deactivated = m.store.user_devices.find(
        (d) => d.user_id === 'unregister-test-user-uuid' && d.fcm_token === 'logout-token-123456'
      );
      expect(deactivated).toBeTruthy();
      expect(deactivated.is_active).toBe(false);
      expect(deactivated.deactivated_at).toBeTruthy();

      const profile = m.store.profiles.find((p) => p.id === 'unregister-test-user-uuid');
      expect(profile.fcm_token).toBeNull();
    });

    it('keeps the user\'s other devices active when one token is unregistered', async () => {
      m.store.user_devices.push(
        { user_id: 'unregister-test-user-uuid', fcm_token: 'logout-token-123456', platform: 'android', is_active: true },
        { user_id: 'unregister-test-user-uuid', fcm_token: 'other-active-token-1', platform: 'ios', is_active: true },
      );
      m.store.profiles.push({
        id: 'unregister-test-user-uuid',
        fcm_token: 'logout-token-123456',
        fcm_token_updated_at: '2026-01-01T00:00:00.000Z',
      });

      const res = await request(buildApp())
        .delete('/api/devices/unregister')
        .set(UNREGISTER_HEADERS)
        .send({ fcmToken: 'logout-token-123456' });

      expect(res.status).toBe(200);
      const rows = m.store.user_devices.filter(d => d.user_id === 'unregister-test-user-uuid');
      expect(rows.find(d => d.fcm_token === 'logout-token-123456').is_active).toBe(false);
      expect(rows.find(d => d.fcm_token === 'other-active-token-1').is_active).toBe(true);
      // Profile fallback moves to the remaining active device.
      const profile = m.store.profiles.find((p) => p.id === 'unregister-test-user-uuid');
      expect(profile.fcm_token).toBe('other-active-token-1');
    });

    it('does not remove another user\'s device record for the same token', async () => {
      m.store.user_devices.push({
        user_id: 'other-user-uuid',
        fcm_token: 'shared-device-token',
        platform: 'android',
      });

      const res = await request(buildApp())
        .delete('/api/devices/unregister')
        .set(UNREGISTER_HEADERS)
        .send({ fcmToken: 'shared-device-token' });

      expect(res.status).toBe(200);

      const stillThere = m.store.user_devices.find(
        (d) => d.user_id === 'other-user-uuid' && d.fcm_token === 'shared-device-token'
      );
      expect(stillThere).toBeTruthy();
    });

    it('returns 500 if database deletion fails and does not expose internal error details', async () => {
      m.programError('Database connection lost');

      const res = await request(buildApp())
        .delete('/api/devices/unregister')
        .set(UNREGISTER_HEADERS)
        .send({ fcmToken: 'token_err_database' });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to unregister device');
    });
  });

  describe('POST /api/devices/unregister', () => {
    const UNREGISTER_HEADERS = {
      'x-user-id': 'unregister-test-user-uuid',
      'x-user-role': 'customer',
      'x-user-name': 'Test Customer',
    };

    it('unregisters the device token via POST (shared app contract)', async () => {
      m.store.user_devices.push({
        user_id: 'unregister-test-user-uuid',
        fcm_token: 'logout-token-123456',
        platform: 'android',
      });
      m.store.profiles.push({
        id: 'unregister-test-user-uuid',
        fcm_token: 'logout-token-123456',
        fcm_token_updated_at: '2026-01-01T00:00:00.000Z',
      });

      const res = await request(buildApp())
        .post('/api/devices/unregister')
        .set(UNREGISTER_HEADERS)
        .send({ fcmToken: 'logout-token-123456' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        message: 'Device token unregistered',
      });

      const remainingDevice = m.store.user_devices.find(
        (d) => d.user_id === 'unregister-test-user-uuid' && d.fcm_token === 'logout-token-123456'
      );
      expect(remainingDevice).toBeUndefined();
    });
  });
});
