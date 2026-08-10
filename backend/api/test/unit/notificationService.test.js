import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseMock } from '../helpers/supabaseMock.js';
import { DomainError } from '../../src/services/order/domainError.js';

const supabaseMock = createSupabaseMock();

const firebaseMock = {
  sendEachForMulticast: vi.fn(),
};

vi.mock('../../src/config/db.js', () => ({
  supabase: supabaseMock.supabase,
  supabaseAdmin: supabaseMock.supabase,
  firebaseAdmin: {
    messaging: () => ({ sendEachForMulticast: firebaseMock.sendEachForMulticast }),
  },
  redisClient: null,
  mongoDb: null,
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

const {
  sendFcmNotification,
  sendPushNotification,
  insertNotification,
  sendDeliveryOtpNotification,
} = await import('../../src/services/notificationService.js');

function okBatch(tokens) {
  return {
    responses: tokens.map((t, i) => ({ success: true, messageId: `msg-${i}` })),
  };
}

function seedDevices(rows) {
  supabaseMock.store.user_devices = rows.map((r, i) => ({
    id: r.id ?? `device-${i}`,
    fcm_token: r.fcm_token,
    user_id: r.user_id ?? 'user-1',
    platform: r.platform ?? 'android',
    device_id: r.device_id ?? null,
    is_active: r.is_active ?? true,
  }));
}

describe('sendFcmNotification — multi-device fan-out', () => {
  beforeEach(() => {
    supabaseMock.reset();
    firebaseMock.sendEachForMulticast.mockReset();
    supabaseMock.store.profiles = [{ id: 'user-1', fcm_token: null }];
  });

  it('sends a single device token to the FCM batch API', async () => {
    seedDevices([{ fcm_token: 'token-a' }]);
    firebaseMock.sendEachForMulticast.mockResolvedValue(okBatch(['token-a']));

    const result = await sendFcmNotification('user-1', { title: 'Hi', body: 'There' }, {});

    expect(firebaseMock.sendEachForMulticast).toHaveBeenCalledTimes(1);
    const call = firebaseMock.sendEachForMulticast.mock.calls[0][0];
    expect(call.tokens).toEqual(['token-a']);
    expect(call.notification).toEqual({ title: 'Hi', body: 'There' });
    expect(result.success).toBe(true);
    expect(result.summary.delivered).toBe(1);
    expect(result.summary.uniqueTokens).toBe(1);
  });

  it('fans out to every active device of the user in a single request', async () => {
    seedDevices([
      { fcm_token: 'token-a' },
      { fcm_token: 'token-b' },
      { fcm_token: 'token-c' },
    ]);
    firebaseMock.sendEachForMulticast.mockResolvedValue(okBatch(['token-a', 'token-b', 'token-c']));

    const result = await sendFcmNotification('user-1', { title: 'Hi', body: 'There' }, {});

    expect(firebaseMock.sendEachForMulticast).toHaveBeenCalledTimes(1);
    expect(firebaseMock.sendEachForMulticast.mock.calls[0][0].tokens.sort()).toEqual(
      ['token-a', 'token-b', 'token-c'].sort()
    );
    expect(result.success).toBe(true);
    expect(result.summary.delivered).toBe(3);
    expect(result.summary.devicesFound).toBe(3);
  });

  it('ignores inactive devices when building the fan-out list', async () => {
    seedDevices([
      { fcm_token: 'token-a', is_active: true },
      { fcm_token: 'token-b', is_active: false },
    ]);
    firebaseMock.sendEachForMulticast.mockResolvedValue(okBatch(['token-a']));

    const result = await sendFcmNotification('user-1', { title: 'Hi', body: 'There' }, {});

    expect(firebaseMock.sendEachForMulticast.mock.calls[0][0].tokens).toEqual(['token-a']);
    expect(result.summary.uniqueTokens).toBe(1);
    expect(result.summary.devicesFound).toBe(1);
  });

  it('deactivates a permanently-invalid device while still delivering to a valid one', async () => {
    seedDevices([
      { id: 'dev-a', fcm_token: 'token-invalid' },
      { id: 'dev-b', fcm_token: 'token-valid' },
    ]);
    firebaseMock.sendEachForMulticast.mockResolvedValue({
      responses: [
        { success: false, error: { code: 'messaging/registration-token-not-registered' } },
        { success: true, messageId: 'msg-b' },
      ],
    });

    const result = await sendFcmNotification('user-1', { title: 'Hi', body: 'There' }, {});

    // The valid device is delivered even though the other one failed.
    expect(result.success).toBe(true);
    expect(result.summary.delivered).toBe(1);
    expect(result.summary.permanent).toBe(1);
    expect(result.summary.deactivated).toBe(1);

    // The invalid device row was soft-deactivated in the store.
    const devA = supabaseMock.store.user_devices.find((d) => d.id === 'dev-a');
    const devB = supabaseMock.store.user_devices.find((d) => d.id === 'dev-b');
    expect(devA.is_active).toBe(false);
    expect(devA.deactivated_at).toBeTruthy();
    expect(devB.is_active).toBe(true);
  });

  it('keeps a device active when FCM reports a transient failure', async () => {
    seedDevices([{ id: 'dev-a', fcm_token: 'token-a' }]);
    firebaseMock.sendEachForMulticast.mockResolvedValue({
      responses: [{ success: false, error: { code: 'messaging/unavailable' } }],
    });

    const result = await sendFcmNotification('user-1', { title: 'Hi', body: 'There' }, {});

    expect(result.success).toBe(false);
    expect(result.summary.transient).toBe(1);
    expect(result.summary.deactivated).toBe(0);
    const devA = supabaseMock.store.user_devices.find((d) => d.id === 'dev-a');
    expect(devA.is_active).toBe(true);
    expect(devA.deactivated_at).toBeUndefined();
  });

  it('deduplicates identical tokens so the same device is never targeted twice', async () => {
    seedDevices([
      { fcm_token: 'token-dup' },
      { fcm_token: 'token-dup' },
    ]);
    firebaseMock.sendEachForMulticast.mockResolvedValue(okBatch(['token-dup']));

    const result = await sendFcmNotification('user-1', { title: 'Hi', body: 'There' }, {});

    expect(firebaseMock.sendEachForMulticast).toHaveBeenCalledTimes(1);
    expect(firebaseMock.sendEachForMulticast.mock.calls[0][0].tokens).toEqual(['token-dup']);
    expect(result.summary.uniqueTokens).toBe(1);
    expect(result.summary.delivered).toBe(1);
  });

  it('falls back to the profile-level token when the user has no device rows', async () => {
    supabaseMock.store.user_devices = [];
    supabaseMock.store.profiles = [{ id: 'user-1', fcm_token: 'profile-token-1' }];
    firebaseMock.sendEachForMulticast.mockResolvedValue(okBatch(['profile-token-1']));

    const result = await sendFcmNotification('user-1', { title: 'Hi', body: 'There' }, {});

    expect(firebaseMock.sendEachForMulticast).toHaveBeenCalledTimes(1);
    expect(firebaseMock.sendEachForMulticast.mock.calls[0][0].tokens).toEqual(['profile-token-1']);
    expect(result.success).toBe(true);
    expect(result.summary.delivered).toBe(1);
  });

  it('does not double-send when the profile token also exists as a device row', async () => {
    seedDevices([{ fcm_token: 'same-token' }]);
    supabaseMock.store.profiles = [{ id: 'user-1', fcm_token: 'same-token' }];
    firebaseMock.sendEachForMulticast.mockResolvedValue(okBatch(['same-token']));

    const result = await sendFcmNotification('user-1', { title: 'Hi', body: 'There' }, {});

    expect(firebaseMock.sendEachForMulticast).toHaveBeenCalledTimes(1);
    expect(firebaseMock.sendEachForMulticast.mock.calls[0][0].tokens).toEqual(['same-token']);
    expect(result.summary.uniqueTokens).toBe(1);
    expect(result.summary.delivered).toBe(1);
  });

  it('returns a controlled NO_FCM_TOKEN failure when no token exists at all', async () => {
    supabaseMock.store.user_devices = [];
    supabaseMock.store.profiles = [{ id: 'user-1', fcm_token: null }];

    const result = await sendFcmNotification('user-1', { title: 'Hi', body: 'There' }, {});

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('NO_FCM_TOKEN');
    expect(firebaseMock.sendEachForMulticast).not.toHaveBeenCalled();
  });

  it('chunks fan-out requests to respect the SDK batch limit', async () => {
    const many = Array.from({ length: 501 }, (_, i) => ({ fcm_token: `token-${i}` }));
    seedDevices(many);
    firebaseMock.sendEachForMulticast.mockImplementation(async ({ tokens }) => okBatch(tokens));

    const result = await sendFcmNotification('user-1', { title: 'Hi', body: 'There' }, {});

    expect(firebaseMock.sendEachForMulticast).toHaveBeenCalledTimes(2);
    expect(firebaseMock.sendEachForMulticast.mock.calls[0][0].tokens).toHaveLength(500);
    expect(firebaseMock.sendEachForMulticast.mock.calls[1][0].tokens).toHaveLength(1);
    expect(result.summary.batches).toBe(2);
    expect(result.summary.delivered).toBe(501);
  });

  it('tracks partial success when only some devices in a batch succeed', async () => {
    seedDevices([
      { id: 'dev-a', fcm_token: 'token-a' },
      { id: 'dev-b', fcm_token: 'token-b' },
      { id: 'dev-c', fcm_token: 'token-c' },
    ]);
    firebaseMock.sendEachForMulticast.mockResolvedValue({
      responses: [
        { success: true, messageId: 'msg-a' },
        { success: false, error: { code: 'messaging/registration-token-not-registered' } },
        { success: false, error: { code: 'messaging/unavailable' } },
      ],
    });

    const result = await sendFcmNotification('user-1', { title: 'Hi', body: 'There' }, {});

    expect(result.success).toBe(true);
    expect(result.summary.delivered).toBe(1);
    expect(result.summary.permanent).toBe(1);
    expect(result.summary.transient).toBe(1);
    expect(result.summary.deactivated).toBe(1);
    expect(result.messageId).toBe('msg-a');
  });
});

describe('sendFcmNotification — sensitive OTP fan-out', () => {
  beforeEach(() => {
    supabaseMock.reset();
    firebaseMock.sendEachForMulticast.mockReset();
    supabaseMock.store.profiles = [];
  });

  it('only targets the customer\'s devices when delivering a delivery OTP', async () => {
    seedDevices([
      { id: 'cust-dev', user_id: 'customer-1', fcm_token: 'customer-token' },
      { id: 'other-dev', user_id: 'driver-9', fcm_token: 'driver-token' },
    ]);
    firebaseMock.sendEachForMulticast.mockResolvedValue(okBatch(['customer-token']));

    const result = await sendDeliveryOtpNotification('customer-1', 'ORD-1001', '123456');

    // Only the customer's token is delivered — the driver never receives it.
    expect(firebaseMock.sendEachForMulticast).toHaveBeenCalledTimes(1);
    expect(firebaseMock.sendEachForMulticast.mock.calls[0][0].tokens).toEqual(['customer-token']);
    expect(result.success).toBe(true);

    // The notification row is persisted WITHOUT the OTP value or any derived
    // digest — an unsalted hash of a 6-digit code must not leak into the table.
    const persisted = supabaseMock.store.notifications.find(
      (n) => n.user_id === 'customer-1'
    );
    expect(persisted).toBeTruthy();
    expect(persisted.notif_type).toBe('order_update');
    expect(persisted.metadata).toEqual({ order_display_id: 'ORD-1001' });
    expect(JSON.stringify(persisted)).not.toContain('123456');
  });
});

describe('insertNotification allowlist validation', () => {
  beforeEach(() => {
    supabaseMock.reset();
  });

  it('throws DomainError for an invalid notif_type', async () => {
    await expect(
      insertNotification({ notif_type: 'invalid_type', user_id: 'user-1' })
    ).rejects.toThrow(DomainError);
  });

  it('accepts allowlisted notif_types and persists the row', async () => {
    const row = await insertNotification({
      notif_type: 'order_update',
      user_id: 'user-1',
      title: 'Order updated',
    });

    expect(row).toBeTruthy();
    const persisted = supabaseMock.store.notifications.find(
      (n) => n.user_id === 'user-1'
    );
    expect(persisted.notif_type).toBe('order_update');
  });
});

describe('sendPushNotification', () => {
  beforeEach(() => {
    supabaseMock.reset();
    firebaseMock.sendEachForMulticast.mockReset();
    supabaseMock.store.profiles = [{ id: 'user-1', fcm_token: 'profile-token-1' }];
  });

  it('throws DomainError for an invalid notif_type before any side effects', async () => {
    await expect(
      sendPushNotification('user-1', 'Title', 'Body', 'unsupported_type', {})
    ).rejects.toThrow(DomainError);
    expect(supabaseMock.store.notifications).toBeUndefined();
    expect(firebaseMock.sendEachForMulticast).not.toHaveBeenCalled();
  });

  it('persists the notification row and fans out to the user\'s devices', async () => {
    seedDevices([{ fcm_token: 'token-a' }]);
    firebaseMock.sendEachForMulticast.mockResolvedValue(okBatch(['token-a']));

    const result = await sendPushNotification(
      'user-1',
      'Order updated',
      'Your order is on the way',
      'order_update',
      { order_display_id: 'ORD-2001' }
    );

    const persisted = supabaseMock.store.notifications.find((n) => n.user_id === 'user-1');
    expect(persisted).toBeTruthy();
    expect(persisted.notif_type).toBe('order_update');
    expect(persisted.metadata).toEqual({ order_display_id: 'ORD-2001' });

    expect(firebaseMock.sendEachForMulticast).toHaveBeenCalledTimes(1);
    expect(firebaseMock.sendEachForMulticast.mock.calls[0][0].data).toEqual({
      notifType: 'order_update',
      order_display_id: 'ORD-2001',
    });
    expect(result.success).toBe(true);
  });
});
