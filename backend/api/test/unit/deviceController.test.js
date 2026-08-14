import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseMock } from '../helpers/supabaseMock.js';

const supabaseMock = createSupabaseMock();

vi.mock('../../src/config/db.js', () => ({
  supabase: supabaseMock.supabase,
  supabaseAdmin: supabaseMock.supabase,
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

const { registerDeviceToken, unregisterDeviceToken } = await import('../../src/controllers/deviceController.js');

function makeResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
}

describe('registerDeviceToken', () => {
  beforeEach(() => {
    supabaseMock.reset();
  });

  it('continues to upsert when the FCM token is valid', async () => {
    const req = {
      user: { id: 'user-1' },
      body: {
        fcmToken: 'valid_token_12345',
        platform: 'android',
      },
    };
    const res = makeResponse();
    const next = vi.fn();

    await registerDeviceToken(req, res, next);

    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
    // Registration goes through the transactional register_device_token RPC,
    // not a direct upsert, so the device row, the previous owner's profile and
    // the current user's profile all commit or roll back together.
    const rpcCall = supabaseMock.calls.find((call) => call.rpc === 'register_device_token');
    expect(rpcCall).toBeDefined();
    expect(rpcCall.args).toMatchObject({
      p_user_id: 'user-1',
      p_fcm_token: 'valid_token_12345',
      p_platform: 'android',
    });
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Device token registered',
    });
  });

  it('returns a validation response when the FCM token is invalid', async () => {
    const req = {
      user: { id: 'user-1' },
      body: { fcmToken: 'bad token with spaces' },
    };
    const res = makeResponse();
    const next = vi.fn();

    await registerDeviceToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
    expect(supabaseMock.calls.some((call) => call.table === 'user_devices')).toBe(false);
  });

  it('returns a structured VALIDATION_ERROR 400 when metadata is invalid', async () => {
    const req = {
      user: { id: 'user-1' },
      body: {
        fcmToken: 'valid_token_12345',
        metadata: 'not-an-object',
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
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });
});

describe('unregisterDeviceToken', () => {
  beforeEach(() => {
    supabaseMock.reset();
  });

  it('returns 404 when the device token is not registered for the user', async () => {
    const req = {
      user: { id: 'user-1' },
      body: { fcmToken: 'valid_token_12345' },
    };
    const res = makeResponse();
    const next = vi.fn();

    await unregisterDeviceToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Device token not found',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('deletes the token and returns success when a matching row exists', async () => {
    supabaseMock.store.user_devices = [
      { id: 'row-1', user_id: 'user-1', fcm_token: 'valid_token_12345' },
    ];

    const req = {
      user: { id: 'user-1' },
      body: { fcmToken: 'valid_token_12345' },
    };
    const res = makeResponse();
    const next = vi.fn();

    await unregisterDeviceToken(req, res, next);

    expect(res.status).not.toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Device token unregistered',
    });
    expect(supabaseMock.calls.some((call) => call.table === 'user_devices' && call.mode === 'delete')).toBe(true);
  });
});
