import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseMock } from '../helpers/supabaseMock.js';
import notificationService from '../../src/services/notificationService.js';
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
import { sendPushNotification, sendFcmNotification } from '../../src/services/notificationService.js';
import crypto from 'crypto';
import { sendPushNotification, sendFcmNotification, hashDeliveryOtp, verifyDeliveryOtpHash } from '../../src/services/notificationService.js';
import crypto from 'crypto';
import notificationService from '../../src/services/notificationService.js';
import { sendPushNotification, sendFcmNotification, hashDeliveryOtp, verifyDeliveryOtpHash } from '../../src/services/notificationService.js';
import { DomainError } from '../../src/services/order/domainError.js';

describe('notificationService allowlist validation', () => {
  it('should throw DomainError for invalid notif_type in insertNotification', async () => {
    const invalidData = { notif_type: 'invalid_type', user_id: '123' };
    await expect(notificationService.insertNotification(invalidData)).rejects.toThrow(DomainError);
  });

  it('should throw DomainError for invalid notif_type in sendPushNotification', async () => {
    const invalidPayload = { notif_type: 'unsupported_type', title: 'Test' };
    await expect(notificationService.sendPushNotification(invalidPayload)).rejects.toThrow(DomainError);
  });

  it('should allow valid notif_types', async () => {
    for (const type of ['order_update', 'payment', 'load_offer', 'trip_update', 'document', 'system']) {
      const payload = { notif_type: type, title: 'Test' };
      // Will attempt supabase call, which might fail or resolve depending on mock, but won't throw DomainError
      await expect(notificationService.sendPushNotification(payload)).resolves.toBeDefined();
    }
  });

  describe('FCM edge cases', () => {
    it('returns null when userId is null in getFcmTokenForUser', async () => {
      const result = await notificationService.getFcmTokenForUser(null);
      expect(result).toBeNull();
    });

    it('returns error result when fcmToken is empty in sendFcmNotification', async () => {
      const result = await notificationService.sendFcmNotification(null, '', { title: 'Test', body: 'Test body' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('No FCM token');
    });
  });
});

// notificationService reads supabaseAdmin and firebaseAdmin (not supabase),
// and getUserFcmToken chains .select().eq().maybeSingle() — a mock lacking
// either export, or with a chain shape that doesn't reach maybeSingle(),
// makes every scenario collapse into the same early-return branch.
const { mockFrom, mockInsert, mockSend } = vi.hoisted(() => {
  const mockMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  const mockEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
  const mockSelect = vi.fn(() => ({ eq: mockEq }));
  const mockInsert = vi.fn().mockResolvedValue({ data: { id: 'fcm-token-1' }, error: null });
  const mockFrom = vi.fn(() => ({ select: mockSelect, insert: mockInsert }));
  const mockSend = vi.fn().mockResolvedValue('mock-message-id');
  return { mockFrom, mockInsert, mockSend };
});

vi.mock('../../src/config/db.js', () => ({
  supabaseAdmin: { from: mockFrom },
  firebaseAdmin: {
    messaging: vi.fn(() => ({ send: mockSend })),
  },
}));

describe('notificationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('sendPushNotification', () => {
    it('returns success:false when userId is null', async () => {
      const result = await sendPushNotification(null, 'Test Title', 'Test Body', 'order_update', {});
      expect(result).toEqual({ success: false, error: 'Missing required fields' });
    });

    it('returns success:false when fcmToken is missing', async () => {
      const result = await sendFcmNotification(null, { title: 'Test', body: 'Test body' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('No FCM token');
    });

    it('resolves without throwing for valid notification', async () => {
      const result = await sendFcmNotification('user-123', { title: 'Test', body: 'Test body' });
      // Result may have success:false (no token) or success:true, but should not throw
      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');
    });

    it('returns success:false when FCM delivery fails even though the notification is persisted', async () => {
      // Simulate an FCM delivery failure. The DB insert still succeeds
      // (mockInsert resolves), but `success` must reflect the push outcome.
      mockSend.mockRejectedValueOnce(new Error('FCM unavailable'));
      const result = await sendPushNotification('user-123', 'Title', 'Body', 'order_update', {});
      expect(result.persisted).toBe(true);
      expect(result.success).toBe(false);
      expect(result.fcm?.success).toBe(false);
    });

    it('accepts valid notif_types without throwing', async () => {
      for (const notifType of ['order_update', 'payment', 'load_offer', 'trip_update', 'document', 'system']) {
        const result = await sendPushNotification('user-123', 'Title', 'Body', notifType, {});
        expect(result).toBeDefined();
      }
    });
  });

  describe('sendFcmNotification', () => {
    it('returns error when fcmToken is empty string', async () => {
      const result = await sendFcmNotification('', { title: 'Test', body: 'Test body' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('No FCM token');
    });

    it('returns error when notification data is null', async () => {
      const result = await sendFcmNotification(null, null);
      expect(result.success).toBe(false);
      expect(result.error).toBe('No FCM token');
    });
  });

  describe('notif_type allowlist', () => {
    // Mirrors notifications_notif_type_check
    // (supabase/migrations/20260807000050_widen_notifications_notif_type_check.sql).
    const VALID_TYPES = [
      'order_update',
      'payment',
      'load_offer',
      'trip_update',
      'document',
      'system',
      'bid_accepted',
      'new_bid',
      'payment_locked',
      'payment_released',
    ];

    it.each(VALID_TYPES)('inserts a notification with notif_type "%s"', async (notifType) => {
      await sendPushNotification('user-1', 'Title', 'Body', notifType);

      expect(mockInsert).toHaveBeenCalledTimes(1);
      expect(mockInsert.mock.calls[0][0]).toMatchObject({ notif_type: notifType });
    });

    it('refuses to insert a notif_type the database CHECK would reject', async () => {
      const result = await sendPushNotification('user-1', 'Title', 'Body', 'invalid_type');

      expect(mockInsert).not.toHaveBeenCalled();
      expect(result.persisted).toBe(false);
    });

    it('still resolves (does not throw) when the notif_type is rejected', async () => {
      await expect(
        sendPushNotification('user-1', 'Title', 'Body', 'invalid_type')
      ).resolves.toBeDefined();
    });
  });

  describe('sendDeliveryOtpNotification (#12329)', () => {
    it('delivers the plaintext OTP to the customer via the FCM data payload', async () => {
      const otp = '654321';
      // Provide an FCM token so the push actually reaches firebaseAdmin.send.
      mockMaybeSingle.mockResolvedValue({ data: { fcm_token: 'fcm-token-xyz' }, error: null });

      const result = await notificationService.sendDeliveryOtpNotification('user-1', 'TX1001', otp);

      expect(result.success).toBe(true);
      expect(mockSend).toHaveBeenCalledTimes(1);
      const sentMessage = mockSend.mock.calls[0][0];
      expect(sentMessage.data).toBeDefined();
      expect(sentMessage.data.otp).toBe(otp);
      expect(sentMessage.data.notifType).toBe('delivery_otp');
    });

    it('does not persist the raw OTP in the notification metadata', async () => {
      const otp = '654321';
      mockMaybeSingle.mockResolvedValue({ data: { fcm_token: 'fcm-token-xyz' }, error: null });

      await notificationService.sendDeliveryOtpNotification('user-1', 'TX1001', otp);

      const inserted = mockInsert.mock.calls[0][0];
      expect(JSON.stringify(inserted.metadata ?? {})).not.toContain(otp);
    });
  });

  describe('delivery OTP hashing', () => {
    it('round-trips a salted hash and rejects a wrong OTP', () => {
      const { hash, salt } = hashDeliveryOtp('123456');
      expect(hash).toMatch(/^[a-f0-9]{128}$/);
      expect(verifyDeliveryOtpHash('123456', { otp_hash: hash, otp_salt: salt })).toBe(true);
      expect(verifyDeliveryOtpHash('654321', { otp_hash: hash, otp_salt: salt })).toBe(false);
    });

    it('still verifies legacy unsalted SHA-256 hashes', () => {
      const legacyHash = crypto.createHash('sha256').update('123456').digest('hex');
      expect(verifyDeliveryOtpHash('123456', { otp_hash: legacyHash })).toBe(true);
      expect(verifyDeliveryOtpHash('999999', { otp_hash: legacyHash })).toBe(false);
    });
  });
});
