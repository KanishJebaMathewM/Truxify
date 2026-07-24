import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseMock } from '../helpers/supabaseMock.js';

const supabaseMock = createSupabaseMock();

vi.mock('../../src/config/db.js', () => ({
  supabase: supabaseMock.supabase,
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

const { registerDeviceToken } = await import('../../src/controllers/deviceController.js');

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
    expect(supabaseMock.calls.some((call) => call.table === 'user_devices' && call.mode === 'upsert')).toBe(true);
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
});
