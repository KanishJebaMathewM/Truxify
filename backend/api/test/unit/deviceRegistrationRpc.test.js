import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ admin: null }));
vi.mock('../../src/config/db.js', () => ({
  get supabaseAdmin() { return mocks.admin; }, supabase: null,
}));
vi.mock('../../src/middleware/logger.js', () => ({ default: { error: vi.fn(), warn: vi.fn() } }));
vi.mock('../../src/services/notificationService.js', () => ({ default: {} }));
import { registerDeviceToken } from '../../src/controllers/deviceController.js';

// The controlled transport models named-argument resolution against the
// repository's actual deployed-function signature, not the controller call.
const migration = readFileSync(new URL('../../../../supabase/migrations/20260810000000_add_device_lifecycle_and_fanout_support.sql', import.meta.url), 'utf8');
const signature = migration.match(/CREATE OR REPLACE FUNCTION register_device_token\(([\s\S]*?)\)\s*RETURNS void/)[1];
const argumentNames = [...signature.matchAll(/^\s*(p_\w+)\s+/gm)].map(match => match[1]).sort();
let calls;
let previousOwner;
let rpcFailure;

beforeEach(() => {
  calls = [];
  previousOwner = null;
  rpcFailure = false;
  mocks.admin = createClient('https://devices.invalid', 'controlled-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: { transport: WebSocket },
    global: { fetch: async (input, options) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/user_devices')) {
        return new Response(JSON.stringify(previousOwner ? [{ user_id: previousOwner }] : []), { status: 200 });
      }
      expect(url.pathname).toBe('/rest/v1/rpc/register_device_token');
      const args = JSON.parse(options.body);
      calls.push(args);
      if (JSON.stringify(Object.keys(args).sort()) !== JSON.stringify(argumentNames)) {
        return Response.json({ code: 'PGRST202', message: 'No function matches the supplied named parameters' }, { status: 404 });
      }
      if (rpcFailure) return Response.json({ message: 'Transaction rejected' }, { status: 400 });
      return new Response(null, { status: 204 });
    } },
  });
});

async function register(body) {
  const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
  const next = vi.fn();
  await registerDeviceToken({ user: { id: '10000000-0000-4000-8000-000000000001' }, body }, res, next);
  return { res, next };
}

describe('device registration named RPC contract', () => {
  it.each([
    { fcmToken: 'legacy_device_token' },
    { fcm_token: 'ios_device_token', device_type: 'ios' },
    { fcmToken: 'rotated_device_token', platform: 'web', deviceId: 'installation-123', metadata: { model: 'test phone' } },
  ])('registers a supported client payload: %j', async body => {
    const { res, next } = await register(body);
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true, message: 'Device token registered' });
    expect(Object.keys(calls[0]).sort()).toEqual(argumentNames);
    expect(calls[0]).toMatchObject({ p_user_id: '10000000-0000-4000-8000-000000000001',
      p_fcm_token: body.fcmToken || body.fcm_token, p_device_id: body.deviceId || null,
      p_platform: body.platform || body.device_type || 'android', p_metadata: body.metadata || {} });
    expect(Number.isFinite(Date.parse(calls[0].p_last_seen))).toBe(true);
  });
  it('preserves the previous owner when a token is reassigned', async () => {
    previousOwner = '20000000-0000-4000-8000-000000000002';
    const { res, next } = await register({ fcmToken: 'reassigned_device_token' });
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(calls[0].p_prev_user_id).toBe(previousOwner);
  });
  it('still propagates a rejected transaction without claiming registration success', async () => {
    rpcFailure = true;
    const { res, next } = await register({ fcmToken: 'rejected_device_token' });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 500 }));
    expect(res.json).not.toHaveBeenCalled();
  });
});
