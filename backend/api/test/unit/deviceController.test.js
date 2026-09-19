import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseMock } from '../helpers/supabaseMock.js';

const supabaseMock = createSupabaseMock();

vi.mock('../../src/config/db.js', () => ({
  
  redisClient: global.mockRedis,
  upstashRedisClient: global.mockRedis,
  supabase: supabaseMock.supabase,
  supabaseAdmin: supabaseMock.supabase,
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock('../../src/services/notificationService.js', () => ({
  default: { pruneStaleDevices: vi.fn().mockResolvedValue({ pruned: 0 }) },
}));

let registerDeviceToken, registerDevice, unregisterDeviceToken,
    unregisterDevice, updateLocation, unregisterAllDeviceTokens, getDevicePlatforms;

beforeAll(async () => {
  const mod = await import('../../src/controllers/deviceController.js');
  registerDeviceToken     = mod.registerDeviceToken;
  registerDevice          = mod.registerDevice;
  unregisterDeviceToken   = mod.unregisterDeviceToken;
  unregisterDevice        = mod.unregisterDevice;
  updateLocation          = mod.updateLocation;
  unregisterAllDeviceTokens = mod.unregisterAllDeviceTokens;
  getDevicePlatforms      = mod.getDevicePlatforms;
});

function makeResponse() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('deviceController', () => {
  beforeEach(() => {
    supabaseMock.reset();
  });

  describe('registerDeviceToken & registerDevice', () => {
    it('is aliased as registerDevice', () => {
      expect(registerDevice).toBe(registerDeviceToken);
    });

    it('returns UnauthorizedError when req.user is missing', async () => {
      const req = { user: null, body: { fcmToken: 'valid_token_12345' } };
      const res = makeResponse();
      const next = vi.fn();

      await registerDeviceToken(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'User not authenticated',
          statusCode: 401,
        })
      );
    });

    it('returns 400 when fcmToken is empty or not a string', async () => {
      const req = { user: { id: 'u-1' }, body: { fcmToken: '' } };
      const res = makeResponse();
      const next = vi.fn();

      await registerDeviceToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'fcmToken must be a non-empty string',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 400 when fcmToken length is out of range', async () => {
      const req = { user: { id: 'u-1' }, body: { fcmToken: 'short' } };
      const res = makeResponse();
      const next = vi.fn();

      await registerDeviceToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'fcmToken length must be between 10 and 4096',
      });
    });

    it('returns 400 when fcmToken contains invalid characters', async () => {
      const req = { user: { id: 'u-1' }, body: { fcmToken: 'invalid token with spaces!' } };
      const res = makeResponse();
      const next = vi.fn();

      await registerDeviceToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'fcmToken contains invalid characters',
      });
    });

    it('passes ValidationError to next when platform is invalid', async () => {
      const req = {
        user: { id: 'u-1' },
        body: { fcmToken: 'valid_token_12345', platform: 'playstation' },
      };
      const res = makeResponse();
      const next = vi.fn();

      await registerDeviceToken(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          message: expect.stringContaining('Platform must be one of: android, ios, web'),
        })
      );
    });

    it('passes ValidationError to next when deviceId is invalid', async () => {
      const req = {
        user: { id: 'u-1' },
        body: { fcmToken: 'valid_token_12345', deviceId: 'ab' }, // too short (< 3)
      };
      const res = makeResponse();
      const next = vi.fn();

      await registerDeviceToken(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          message: 'deviceId length must be between 3 and 128',
        })
      );
    });

    it('passes ValidationError to next when deviceId contains invalid characters', async () => {
      const req = {
        user: { id: 'u-1' },
        body: { fcmToken: 'valid_token_12345', deviceId: 'device#invalid$' },
      };
      const res = makeResponse();
      const next = vi.fn();

      await registerDeviceToken(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          message: 'deviceId contains invalid characters',
        })
      );
    });

    it('passes ValidationError to next when deviceId is not a string', async () => {
      const req = {
        user: { id: 'u-1' },
        body: { fcmToken: 'valid_token_12345', deviceId: 12345 },
      };
      const res = makeResponse();
      const next = vi.fn();

      await registerDeviceToken(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          message: 'deviceId must be a string',
        })
      );
    });

    it('returns a structured VALIDATION_ERROR 400 when metadata is not an object', async () => {
      const req = {
        user: { id: 'u-1' },
        body: {
          fcmToken: 'valid_token_12345',
          metadata: 'string-meta',
        },
      };
      const res = makeResponse();
      const next = vi.fn();

      await registerDeviceToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: 'VALIDATION_ERROR',
            message: 'metadata must be an object',
          }),
        })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('handles lookup error for previous device token owner', async () => {
      supabaseMock.programErrorFor('user_devices', 'select', 'Database connection lost');

      const req = {
        user: { id: 'u-1' },
        body: { fcmToken: 'valid_token_12345' },
      };
      const res = makeResponse();
      const next = vi.fn();

      await registerDeviceToken(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 500,
          message: 'Failed to register device',
        })
      );
    });

    it('handles register_device_token RPC failure', async () => {
      supabaseMock.programRpcError('RPC failed');

      const req = {
        user: { id: 'u-1' },
        body: { fcmToken: 'valid_token_12345' },
      };
      const res = makeResponse();
      const next = vi.fn();

      await registerDeviceToken(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 500,
          message: 'Failed to register device',
        })
      );
    });

    it('successfully registers device token with valid payload', async () => {
      const req = {
        user: { id: 'u-1' },
        body: {
          fcmToken: 'valid_token_12345',
          platform: 'ios',
          deviceId: 'device-abc-123',
          metadata: { appVersion: '2.0.0' },
        },
      };
      const res = makeResponse();
      const next = vi.fn();

      await registerDevice(req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Device token registered',
      });
      const rpcCall = supabaseMock.calls.find((call) => call.rpc === 'register_device_token');
      expect(rpcCall).toBeDefined();
      expect(rpcCall.args).toMatchObject({
        p_user_id: 'u-1',
        p_fcm_token: 'valid_token_12345',
        p_platform: 'ios',
        p_device_id: 'device-abc-123',
        p_metadata: { appVersion: '2.0.0' },
      });
    });
  });

  describe('unregisterDeviceToken & unregisterDevice', () => {
    it('is aliased as unregisterDevice', () => {
      expect(unregisterDevice).toBe(unregisterDeviceToken);
    });

    it('returns UnauthorizedError when req.user is missing', async () => {
      const req = { user: null, body: { fcmToken: 'valid_token_12345' } };
      const res = makeResponse();
      const next = vi.fn();

      await unregisterDeviceToken(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'User not authenticated',
          statusCode: 401,
        })
      );
    });

    it('returns 400 when fcmToken is invalid', async () => {
      const req = { user: { id: 'u-1' }, body: { fcmToken: 'bad' } };
      const res = makeResponse();
      const next = vi.fn();

      await unregisterDeviceToken(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'fcmToken length must be between 10 and 4096',
      });
    });

    it('passes AppError to next when RPC fails', async () => {
      supabaseMock.programRpcError('RPC failure');

      const req = { user: { id: 'u-1' }, body: { fcmToken: 'valid_token_12345' } };
      const res = makeResponse();
      const next = vi.fn();

      await unregisterDeviceToken(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 500,
          message: 'Failed to unregister device',
        })
      );
    });

    it('returns 404 when token was not registered for the user', async () => {
      const req = { user: { id: 'u-1' }, body: { fcmToken: 'valid_token_12345' } };
      const res = makeResponse();
      const next = vi.fn();

      await unregisterDevice(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Device token not found',
      });
    });

    it('successfully unregisters device and syncs profile fallback', async () => {
      supabaseMock.store.user_devices = [
        { id: 'row-1', user_id: 'u-1', fcm_token: 'valid_token_12345', is_active: true },
        { id: 'row-2', user_id: 'u-1', fcm_token: 'remaining_token_67890', is_active: true },
      ];
      supabaseMock.store.profiles = [
        { id: 'u-1', fcm_token: 'valid_token_12345' },
      ];

      const req = { user: { id: 'u-1' }, body: { fcmToken: 'valid_token_12345' } };
      const res = makeResponse();
      const next = vi.fn();

      await unregisterDevice(req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Device token unregistered',
      });
      const profile = supabaseMock.store.profiles.find((p) => p.id === 'u-1');
      expect(profile.fcm_token).toBe('remaining_token_67890');
    });
  });

  describe('updateLocation', () => {
    it('returns UnauthorizedError when req.user is missing', async () => {
      const req = {
        user: null,
        body: { latitude: 12.9716, longitude: 77.5946 },
      };
      const res = makeResponse();
      const next = vi.fn();

      await updateLocation(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'User not authenticated',
          statusCode: 401,
        })
      );
    });

    it('returns 400 when latitude is invalid or out of range', async () => {
      const testCases = [undefined, null, 'invalid', 95, -95];

      for (const lat of testCases) {
        const req = {
          user: { id: 'u-1' },
          body: { latitude: lat, longitude: 77.5946 },
        };
        const res = makeResponse();
        const next = vi.fn();

        await updateLocation(req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
          error: 'latitude must be a valid number between -90 and 90',
        });
      }
    });

    it('returns 400 when longitude is invalid or out of range', async () => {
      const testCases = [undefined, null, 'invalid', 185, -185];

      for (const lng of testCases) {
        const req = {
          user: { id: 'u-1' },
          body: { latitude: 12.9716, longitude: lng },
        };
        const res = makeResponse();
        const next = vi.fn();

        await updateLocation(req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
          error: 'longitude must be a valid number between -180 and 180',
        });
      }
    });

    it('handles database upsert error', async () => {
      supabaseMock.programErrorFor('user_locations', 'upsert', 'Database write error');

      const req = {
        user: { id: 'u-1' },
        body: { latitude: 12.9716, longitude: 77.5946 },
      };
      const res = makeResponse();
      const next = vi.fn();

      await updateLocation(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 500,
          message: 'Failed to update location',
        })
      );
    });

    it('successfully updates location with optional speed and heading', async () => {
      const req = {
        user: { id: 'u-1' },
        body: {
          latitude: '12.9716',
          longitude: '77.5946',
          heading: 180.5,
          speed: 45.2,
        },
      };
      const res = makeResponse();
      const next = vi.fn();

      await updateLocation(req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Location updated',
      });
      const locationRow = supabaseMock.store.user_locations?.find((l) => l.user_id === 'u-1');
      expect(locationRow).toBeDefined();
      expect(locationRow).toMatchObject({
        user_id: 'u-1',
        latitude: 12.9716,
        longitude: 77.5946,
        heading: 180.5,
        speed: 45.2,
      });
    });

    it('sets heading and speed to null when omitted or non-numeric', async () => {
      const req = {
        user: { id: 'u-1' },
        body: {
          latitude: 12.9716,
          longitude: 77.5946,
          heading: 'not-a-number',
          speed: null,
        },
      };
      const res = makeResponse();
      const next = vi.fn();

      await updateLocation(req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Location updated',
      });
      const locationRow = supabaseMock.store.user_locations?.find((l) => l.user_id === 'u-1');
      expect(locationRow.heading).toBeNull();
      expect(locationRow.speed).toBeNull();
    });
  });

  describe('unregisterAllDeviceTokens', () => {
    it('deactivates active devices and clears profile token', async () => {
      supabaseMock.store.user_devices = [
        { id: 'd-1', user_id: 'u-1', fcm_token: 'tok-1', is_active: true },
        { id: 'd-2', user_id: 'u-1', fcm_token: 'tok-2', is_active: false },
      ];
      supabaseMock.store.profiles = [
        { id: 'u-1', fcm_token: 'tok-1' },
      ];

      await unregisterAllDeviceTokens('u-1');

      const d1 = supabaseMock.store.user_devices.find((d) => d.id === 'd-1');
      expect(d1.is_active).toBe(false);
      const profile = supabaseMock.store.profiles.find((p) => p.id === 'u-1');
      expect(profile.fcm_token).toBeNull();
    });

    it('throws when user_devices update encounters an error', async () => {
      supabaseMock.programErrorFor('user_devices', 'update', 'Update error');

      await expect(unregisterAllDeviceTokens('u-1')).rejects.toThrow();
    });
  });

  describe('getDevicePlatforms', () => {
    it('returns platforms that have active devices', async () => {
      supabaseMock.store.user_devices = [
        { platform: 'android', is_active: true },
        { platform: 'ios', is_active: false },
      ];

      const req = {};
      const res = makeResponse();
      const next = vi.fn();

      await getDevicePlatforms(req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        platforms: ['android'],
      });
    });

    it('handles query errors by calling next with error', async () => {
      supabaseMock.programErrorFor('user_devices', 'select', 'Database query error');

      const req = {};
      const res = makeResponse();
      const next = vi.fn();

      await getDevicePlatforms(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Database query error',
        })
      );
    });
  });
});
