/**
 * @fileoverview Unit tests for the restored notificationService ESM module.
 * Resolves Issue #8494: Validates that sendPushNotification and other
 * exports work correctly after the module was corrupted by a CommonJS stub.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  sendPushNotification,
  sendNotification,
  insertNotification,
} from '../../src/services/notificationService.js';
import {
  validateNotifType,
  ALLOWED_NOTIF_TYPES,
  FCM_ENABLED_TYPES,
  HIGH_PRIORITY_TYPES,
} from '../../src/lib/notifTypeAllowlist.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import { createSupabaseMock } from '../helpers/supabaseMock.js';
import { DomainError } from '../../src/services/order/domainError.js';

const supabaseMock = createSupabaseMock();

const firebaseMock = {
  sendEachForMulticast: vi.fn(),
  send: vi.fn(),
};

const mockRedis = {
  publish: vi.fn().mockResolvedValue(1),
};

vi.mock('../../src/config/db.js', () => ({
  supabase: supabaseMock.supabase,
  supabaseAdmin: supabaseMock.supabase,
  firebaseAdmin: {
    messaging: () => ({
      sendEachForMulticast: firebaseMock.sendEachForMulticast,
      send: firebaseMock.send,
    }),
  },
  redisClient: mockRedis,
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
  default: notificationService,
  sendFcmNotification,
  sendPushNotification,
  insertNotification,
  sendDeliveryOtpNotification,
  hashDeliveryOtp,
  verifyDeliveryOtpHash,
  storeDeliveryOtp,
  getActiveDeliveryOtp,
  verifyDeliveryOtp,
  expireDeliveryOtps,
  getUserFcmToken,
  isTransientError,
  clearInvalidToken,
  pruneStaleDevices,
  sendToDevice,
  sendNotification,
  publishNotification,
  publishNotificationEvent,
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
    deactivated_at: r.deactivated_at ?? (r.is_active === false ? new Date().toISOString() : null),
  }));
}

describe('notificationService', () => {
  beforeEach(() => {
    supabaseMock.reset();
    firebaseMock.sendEachForMulticast.mockReset();
    firebaseMock.send.mockReset();
    mockRedis.publish.mockReset();
    supabaseMock.store.profiles = [{ id: 'user-1', fcm_token: null }];
  });

  describe('sendFcmNotification — multi-device fan-out', () => {
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

      expect(result.success).toBe(true);
      expect(result.summary.delivered).toBe(1);
      expect(result.summary.permanent).toBe(1);
      expect(result.summary.deactivated).toBe(1);

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

    it('exhausts all retries on repeated transient failures and returns success:false', async () => {
      seedDevices([{ fcm_token: 'token-a' }]);
      const transientErr = new Error('Service Unavailable');
      transientErr.code = 'messaging/unavailable';
      firebaseMock.sendEachForMulticast.mockRejectedValue(transientErr);

      const result = await sendFcmNotification('user-1', { title: 'Hi', body: 'There' }, {});

      expect(firebaseMock.sendEachForMulticast).toHaveBeenCalledTimes(3);
      expect(result.success).toBe(false);
      expect(result.summary.transient).toBe(1);
      expect(result.summary.delivered).toBe(0);
      expect(result.summary.deactivated).toBe(0);
    });

    it('returns controlled failure when Firebase messaging is unconfigured', async () => {
      const dbModule = await import('../../src/config/db.js');
      const originalMessaging = dbModule.firebaseAdmin.messaging;
      dbModule.firebaseAdmin.messaging = null;

      try {
        const result = await sendFcmNotification('user-1', { title: 'Hi', body: 'There' }, {});
        expect(result.success).toBe(false);
        expect(result.errorCode).toBe('FCM_NOT_CONFIGURED');
        expect(result.error).toBe('Firebase not configured');
      } finally {
        dbModule.firebaseAdmin.messaging = originalMessaging;
      }
    });
  });

  describe('sendDeliveryOtpNotification', () => {
    it("only targets the customer's devices when delivering a delivery OTP and includes OTP in body and FCM payload", async () => {
      seedDevices([
        { id: 'cust-dev', user_id: 'customer-1', fcm_token: 'customer-token' },
        { id: 'other-dev', user_id: 'driver-9', fcm_token: 'driver-token' },
      ]);
      firebaseMock.sendEachForMulticast.mockResolvedValue(okBatch(['customer-token']));

      const result = await sendDeliveryOtpNotification('customer-1', 'ORD-1001', '123456');

      expect(firebaseMock.sendEachForMulticast).toHaveBeenCalledTimes(1);
      expect(firebaseMock.sendEachForMulticast.mock.calls[0][0].tokens).toEqual(['customer-token']);
      expect(firebaseMock.sendEachForMulticast.mock.calls[0][0].notification.body).toContain('123456');
      expect(firebaseMock.sendEachForMulticast.mock.calls[0][0].data).toEqual({
        orderDisplayId: 'ORD-1001',
        notifType: 'delivery_otp',
        otp: '123456',
      });
      expect(result.success).toBe(true);

      const persisted = supabaseMock.store.notifications.find(
        (n) => n.user_id === 'customer-1'
      );
      expect(persisted).toBeTruthy();
      expect(persisted.notif_type).toBe('delivery_otp');
      expect(persisted.body).toContain('123456');
      expect(persisted.metadata).toEqual({ order_display_id: 'ORD-1001' });
    });
  });

  describe('insertNotification allowlist validation', () => {
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

    it('handles database insert errors gracefully', async () => {
      supabaseMock.programError('Database connection error');
      const row = await insertNotification({
        notif_type: 'order_update',
        user_id: 'user-1',
        title: 'Order updated',
      });
      expect(row).toBeNull();
    });
  });

  describe('sendPushNotification', () => {
    it('throws DomainError for an invalid notif_type before any side effects', async () => {
      await expect(
        sendPushNotification('user-1', 'Title', 'Body', 'unsupported_type', {})
      ).rejects.toThrow(DomainError);
      expect(supabaseMock.store.notifications ?? []).toHaveLength(0);
      expect(firebaseMock.sendEachForMulticast).not.toHaveBeenCalled();
    });

    it("persists the notification row and fans out to the user's devices", async () => {
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

    it('handles FCM failure while persisting the notification', async () => {
      seedDevices([{ fcm_token: 'token-a' }]);
      firebaseMock.sendEachForMulticast.mockRejectedValue(new Error('FCM unavailable'));

      const result = await sendPushNotification(
        'user-1',
        'Order updated',
        'Your order is on the way',
        'order_update',
        {}
      );

      expect(result.success).toBe(false);
      expect(supabaseMock.store.notifications).toHaveLength(1);
    });

    it('continues FCM delivery even when database insertion fails', async () => {
      seedDevices([{ fcm_token: 'token-a' }]);
      firebaseMock.sendEachForMulticast.mockResolvedValue(okBatch(['token-a']));
      supabaseMock.programErrorFor('notifications', 'insert', 'Database write failure');

      const result = await sendPushNotification(
        'user-1',
        'Order updated',
        'Your order is on the way',
        'order_update',
        {}
      );

      expect(firebaseMock.sendEachForMulticast).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      expect(result.fcm.summary.delivered).toBe(1);
    });

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
      'delivery_otp',
    ];

    it.each(VALID_TYPES)('accepts valid notif_type "%s"', async (notifType) => {
      seedDevices([{ fcm_token: 'token-a' }]);
      firebaseMock.sendEachForMulticast.mockResolvedValue(okBatch(['token-a']));

      const result = await sendPushNotification('user-1', 'Title', 'Body', notifType);
      expect(result.success).toBe(true);
      expect(supabaseMock.store.notifications[0].notif_type).toBe(notifType);
    });
  });

  describe('storeDeliveryOtp, getActiveDeliveryOtp, verifyDeliveryOtp, expireDeliveryOtps', () => {
    it('stores a delivery OTP, invalidating previous active ones', async () => {
      supabaseMock.store.delivery_otps = [
        { id: 'otp-old', order_id: 'order-1', verified: false, expires_at: '2099-01-01T00:00:00.000Z' },
      ];

      const stored = await storeDeliveryOtp('order-1', '123456', 15);
      expect(stored).toBeDefined();

      const oldOtp = supabaseMock.store.delivery_otps.find((o) => o.id === 'otp-old');
      expect(oldOtp.verified).toBe(true);

      const newOtps = supabaseMock.store.delivery_otps.filter((o) => o.id !== 'otp-old');
      expect(newOtps).toHaveLength(1);
      expect(newOtps[0].order_id).toBe('order-1');
      expect(newOtps[0].otp_hash).toBeDefined();
      expect(newOtps[0].otp_salt).toBeDefined();
      expect(newOtps[0].verified).toBe(false);
    });

    it('returns null on storeDeliveryOtp database failure', async () => {
      supabaseMock.programErrorFor('delivery_otps', 'insert', 'Insert failed');
      const result = await storeDeliveryOtp('order-1', '123456');
      expect(result).toBeNull();
    });

    it('fetches the active delivery OTP for an order', async () => {
      const { hash, salt } = hashDeliveryOtp('123456');
      supabaseMock.store.delivery_otps = [
        {
          id: 'otp-1',
          order_id: 'order-100',
          otp_hash: hash,
          otp_salt: salt,
          expires_at: new Date(Date.now() + 100000).toISOString(),
          verified: false,
          created_at: new Date().toISOString(),
        },
      ];

      const activeOtp = await getActiveDeliveryOtp('order-100');
      expect(activeOtp).toBeDefined();
      expect(activeOtp.id).toBe('otp-1');
      expect(activeOtp.otp_hash).toBe(hash);
    });

    it('returns null on getActiveDeliveryOtp database failure', async () => {
      supabaseMock.programError('Fetch failed');
      const result = await getActiveDeliveryOtp('order-100');
      expect(result).toBeNull();
    });

    it('verifies a delivery OTP by id', async () => {
      supabaseMock.store.delivery_otps = [
        { id: 'otp-valid', order_id: 'order-1', verified: false },
      ];

      const verified = await verifyDeliveryOtp('otp-valid');
      expect(verified).toBe(true);

      const otp = supabaseMock.store.delivery_otps.find((o) => o.id === 'otp-valid');
      expect(otp.verified).toBe(true);
      expect(otp.verified_at).toBeDefined();
    });

    it('returns false when OTP not found or already verified', async () => {
      supabaseMock.store.delivery_otps = [
        { id: 'otp-verified', order_id: 'order-1', verified: true },
      ];

      const verified = await verifyDeliveryOtp('otp-verified');
      expect(verified).toBe(false);
    });

    it('expires unverified delivery OTPs for an order', async () => {
      supabaseMock.store.delivery_otps = [
        { id: 'otp-1', order_id: 'order-1', verified: false, expires_at: '2099-01-01T00:00:00.000Z' },
        { id: 'otp-2', order_id: 'order-2', verified: false, expires_at: '2099-01-01T00:00:00.000Z' },
      ];

      await expireDeliveryOtps('order-1');

      const otp1 = supabaseMock.store.delivery_otps.find((o) => o.id === 'otp-1');
      const otp2 = supabaseMock.store.delivery_otps.find((o) => o.id === 'otp-2');
      expect(new Date(otp1.expires_at).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
      expect(otp2.expires_at).toBe('2099-01-01T00:00:00.000Z');
    });
  });

  describe('delivery OTP hashing and verification', () => {
    it('round-trips a salted hash and rejects a wrong OTP', () => {
      const { hash, salt } = hashDeliveryOtp('123456');
      expect(hash).toMatch(/^[a-f0-9]{128}$/);
      expect(verifyDeliveryOtpHash('123456', { otp_hash: hash, otp_salt: salt })).toBe(true);
      expect(verifyDeliveryOtpHash('654321', { otp_hash: hash, otp_salt: salt })).toBe(false);
    });

    it('verifies legacy unsalted SHA-256 hashes', () => {
      const legacyHash = crypto.createHash('sha256').update('123456').digest('hex');
      expect(verifyDeliveryOtpHash('123456', { otp_hash: legacyHash })).toBe(true);
      expect(verifyDeliveryOtpHash('999999', { otp_hash: legacyHash })).toBe(false);
    });
  });

  describe('getUserFcmToken helper', () => {
    it('returns FCM token when active device token exists', async () => {
      seedDevices([{ fcm_token: 'device-token-123' }]);
      const token = await getUserFcmToken('user-1');
      expect(token).toBe('device-token-123');
    });

    it('returns profile FCM token when no active devices exist', async () => {
      supabaseMock.store.user_devices = [];
      supabaseMock.store.profiles = [{ id: 'user-1', fcm_token: 'profile-token-456' }];
      const token = await getUserFcmToken('user-1');
      expect(token).toBe('profile-token-456');
    });

    it('returns null when no token exists for user', async () => {
      supabaseMock.store.user_devices = [];
      supabaseMock.store.profiles = [{ id: 'user-1', fcm_token: null }];
      const token = await getUserFcmToken('user-1');
      expect(token).toBeNull();
    });

    it('returns null when userId is missing', async () => {
      const token = await getUserFcmToken(null);
      expect(token).toBeNull();
    });
  });

  describe('isTransientError helper', () => {
    it('returns true for status codes 429, 500, 503', () => {
      expect(isTransientError(429)).toBe(true);
      expect(isTransientError(500)).toBe(true);
      expect(isTransientError(503)).toBe(true);
      expect(isTransientError('429')).toBe(true);
      expect(isTransientError('500')).toBe(true);
      expect(isTransientError('503')).toBe(true);
      expect(isTransientError({ status: 500 })).toBe(true);
      expect(isTransientError({ code: 429 })).toBe(true);
    });

    it('returns false for status codes 400, 401', () => {
      expect(isTransientError(400)).toBe(false);
      expect(isTransientError(401)).toBe(false);
      expect(isTransientError('400')).toBe(false);
      expect(isTransientError('401')).toBe(false);
      expect(isTransientError({ status: 400 })).toBe(false);
    });

    it('returns true for FCM transient error codes', () => {
      expect(isTransientError('messaging/unavailable')).toBe(true);
      expect(isTransientError('messaging/internal-error')).toBe(true);
      expect(isTransientError('messaging/server-unavailable')).toBe(true);
      expect(isTransientError({ code: 'messaging/unavailable' })).toBe(true);
    });

    it('returns false for FCM permanent or invalid payload error codes', () => {
      expect(isTransientError('messaging/invalid-registration-token')).toBe(false);
      expect(isTransientError('messaging/registration-token-not-registered')).toBe(false);
      expect(isTransientError('messaging/invalid-argument')).toBe(false);
    });

    it('returns false for falsy or unknown input', () => {
      expect(isTransientError(null)).toBe(false);
      expect(isTransientError(undefined)).toBe(false);
      expect(isTransientError('unknown_error')).toBe(false);
    });
  });

  describe('clearInvalidToken helper', () => {
    it('calls profile update to clear fcm_token on invalid token', async () => {
      supabaseMock.store.profiles = [{ id: 'user-1', fcm_token: 'invalid-token-abc' }];
      const result = await clearInvalidToken('user-1', 'invalid-token-abc');
      expect(result).toBe(true);
      const profile = supabaseMock.store.profiles.find((p) => p.id === 'user-1');
      expect(profile.fcm_token).toBeNull();
      expect(profile.fcm_token_updated_at).toBeTruthy();
    });

    it('handles token and userId passed in either order', async () => {
      supabaseMock.store.profiles = [{ id: 'user-1', fcm_token: 'token-abc' }];
      const result = await clearInvalidToken('token-abc', 'user-1');
      expect(result).toBe(true);
      const profile = supabaseMock.store.profiles.find((p) => p.id === 'user-1');
      expect(profile.fcm_token).toBeNull();
    });
  });

  describe('pruneStaleDevices', () => {
    it('prunes device records deactivated longer than specified days', async () => {
      const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
      const recentDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

      supabaseMock.store.user_devices = [
        { id: 'dev-1', fcm_token: 't1', is_active: false, deactivated_at: oldDate },
        { id: 'dev-2', fcm_token: 't2', is_active: false, deactivated_at: recentDate },
        { id: 'dev-3', fcm_token: 't3', is_active: true },
      ];

      const result = await pruneStaleDevices(30);
      expect(result.pruned).toBe(1);
      expect(supabaseMock.store.user_devices.map((d) => d.id)).toEqual(['dev-2', 'dev-3']);
    });

    it('handles database error gracefully', async () => {
      supabaseMock.programError('Delete failed');
      const result = await pruneStaleDevices(30);
      expect(result.pruned).toBe(0);
    });
  });

  describe('sendToDevice', () => {
    it('rejects invalid or non-string tokens', async () => {
      expect((await sendToDevice(null, {})).success).toBe(false);
      expect((await sendToDevice('', {})).success).toBe(false);
      expect((await sendToDevice(123, {})).success).toBe(false);
    });

    it('sends notification using firebase messaging send', async () => {
      firebaseMock.send.mockResolvedValue('msg-single-123');

      const result = await sendToDevice('valid-token', {
        notification: { title: 'Test', body: 'Body' },
        data: { key: 'val' },
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('msg-single-123');
      expect(firebaseMock.send).toHaveBeenCalledWith({
        token: 'valid-token',
        notification: { title: 'Test', body: 'Body' },
        data: { key: 'val' },
      });
    });

    it('catches and returns errorCode on failure', async () => {
      const error = new Error('Invalid token');
      error.code = 'messaging/invalid-registration-token';
      firebaseMock.send.mockRejectedValue(error);

      const result = await sendToDevice('bad-token', {});
      expect(result.success).toBe(false);
      expect(result.error).toBe('messaging/invalid-registration-token');
    });
  });

  describe('sendNotification with per-device tracking', () => {
    it('delivers to each active device and publishes to Redis', async () => {
      seedDevices([
        { id: 'dev-1', fcm_token: 'token-1' },
        { id: 'dev-2', fcm_token: 'token-2' },
      ]);
      firebaseMock.send.mockResolvedValue('msg-id-ok');

      const payload = { notification: { title: 'Hello', body: 'World' } };
      const results = await sendNotification('user-1', payload);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
      expect(mockRedis.publish).toHaveBeenCalledWith('notifications', JSON.stringify(payload));
    });

    it('deactivates devices that return permanent error codes', async () => {
      seedDevices([
        { id: 'dev-bad', fcm_token: 'token-bad' },
      ]);
      const err = new Error('Token not registered');
      err.code = 'messaging/registration-token-not-registered';
      firebaseMock.send.mockRejectedValue(err);

      const results = await sendNotification('user-1', { notification: { title: 'Hi' } });

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);

      const dev = supabaseMock.store.user_devices.find((d) => d.id === 'dev-bad');
      expect(dev.is_active).toBe(false);
    });

    it('uses profile fallback token when no active devices exist', async () => {
      supabaseMock.store.user_devices = [];
      supabaseMock.store.profiles = [{ id: 'user-1', fcm_token: 'profile-tok' }];
      firebaseMock.send.mockResolvedValue('msg-profile');

      const results = await sendNotification('user-1', { notification: { title: 'Hi' } });

      expect(results).toHaveLength(1);
      expect(results[0].deviceId).toBe('profile-fallback');
      expect(results[0].success).toBe(true);
    }); 

    it('continues device delivery even if Redis publish throws an error', async () => {
      seedDevices([{ id: 'dev-1', fcm_token: 'token-1' }]);
      firebaseMock.send.mockResolvedValue('msg-id-ok');
      mockRedis.publish.mockRejectedValueOnce(new Error('Redis publishing error'));

      const payload = { notification: { title: 'Hello', body: 'World' } };
      const results = await sendNotification('user-1', payload);

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(firebaseMock.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('publishNotification', () => {
    it('publishes payload to Redis channel', async () => {
      const payload = { event: 'test' };
      const result = await publishNotification(payload);
      expect(result).toBe(true);
      expect(mockRedis.publish).toHaveBeenCalledWith('notifications', JSON.stringify(payload));
    });

    it('publishNotificationEvent alias functions identically', async () => {
      const payload = { event: 'test-alias' };
      const result = await publishNotificationEvent(payload);
      expect(result).toBe(true);
      expect(mockRedis.publish).toHaveBeenCalledWith('notifications', JSON.stringify(payload));
    });

    it('returns false on Redis error', async () => {
      mockRedis.publish.mockRejectedValueOnce(new Error('Redis down'));
      const result = await publishNotification({ event: 'test' });
      expect(result).toBe(false);
    });
  });

  describe('default export verification', () => {
    it('exposes all expected methods and aliases on default export', () => {
      expect(notificationService.sendFcmNotification).toBe(sendFcmNotification);
      expect(notificationService.sendPushNotification).toBe(sendPushNotification);
      expect(notificationService.insertNotification).toBe(insertNotification);
      expect(notificationService.sendDeliveryOtpNotification).toBe(sendDeliveryOtpNotification);
      expect(notificationService.hashDeliveryOtp).toBe(hashDeliveryOtp);
      expect(notificationService.verifyDeliveryOtpHash).toBe(verifyDeliveryOtpHash);
      expect(notificationService.storeDeliveryOtp).toBe(storeDeliveryOtp);
      expect(notificationService.getActiveDeliveryOtp).toBe(getActiveDeliveryOtp);
      expect(notificationService.verifyDeliveryOtp).toBe(verifyDeliveryOtp);
      expect(notificationService.expireDeliveryOtps).toBe(expireDeliveryOtps);
      expect(notificationService.getUserFcmToken).toBe(getUserFcmToken);
      expect(notificationService.getFcmTokenForUser).toBe(getUserFcmToken);
      expect(notificationService.isTransientError).toBe(isTransientError);
      expect(notificationService.clearInvalidToken).toBe(clearInvalidToken);
      expect(notificationService.pruneStaleDevices).toBe(pruneStaleDevices);
      expect(notificationService.sendToDevice).toBe(sendToDevice);
      expect(notificationService.sendNotification).toBe(sendNotification);
      expect(notificationService.publishNotification).toBe(publishNotification);
      expect(notificationService.publishNotificationEvent).toBe(publishNotificationEvent);
    });
  });
});

// Mock the database client
vi.mock('../../src/config/db.js', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      insert: vi.fn().mockResolvedValue({ data: [{ id: 'notif-123' }], error: null }),
      select: vi.fn().mockResolvedValue({ data: [], error: null }),
    })),
  },
}));

// Mock FCM admin
vi.mock('firebase-admin', () => ({
  default: {
    messaging: () => ({
      send: vi.fn().mockResolvedValue('message-id-123'),
      sendMulticast: vi.fn().mockResolvedValue({ successCount: 1, failureCount: 0 }),
    }),
  },
}));

describe('Notification Service (#8494)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Module Exports', () => {
    it('exports sendPushNotification function', () => {
      expect(typeof sendPushNotification).toBe('function');
    });

    it('exports sendNotification function', () => {
      expect(typeof sendNotification).toBe('function');
    });

    it('exports insertNotification function', () => {
      expect(typeof insertNotification).toBe('function');
    });
  });

  describe('sendPushNotification', () => {
    it('accepts valid arguments without throwing', async () => {
      await expect(
        sendPushNotification('user-123', 'Test Title', 'Test Body', { notif_type: 'order_update' })
      ).resolves.not.toThrow();
    });

    it('handles missing optional data gracefully', async () => {
      await expect(
        sendPushNotification('user-123', 'Title', 'Body')
      ).resolves.not.toThrow();
    });

    it('handles null user ID gracefully', async () => {
      await expect(
        sendPushNotification(null, 'Title', 'Body')
      ).resolves.not.toThrow();
    });

    it('handles empty string user ID', async () => {
      await expect(
        sendPushNotification('', 'Title', 'Body')
      ).resolves.not.toThrow();
    });
  });

  describe('sendNotification', () => {
    it('accepts valid notification object', async () => {
      await expect(
        sendNotification({
          userId: 'user-123',
          title: 'Test',
          body: 'Test body',
          notif_type: 'order_update',
        })
      ).resolves.not.toThrow();
    });

    it('rejects missing userId', async () => {
      await expect(
        sendNotification({ title: 'Test', body: 'Test', notif_type: 'order_update' })
      ).rejects.toThrow();
    });

    it('rejects missing title', async () => {
      await expect(
        sendNotification({ userId: 'user-123', body: 'Test', notif_type: 'order_update' })
      ).rejects.toThrow();
    });

    it('rejects invalid notif_type', async () => {
      await expect(
        sendNotification({
          userId: 'user-123',
          title: 'Test',
          body: 'Test',
          notif_type: 'invalid_type_xyz',
        })
      ).rejects.toThrow(/Invalid notif_type/);
    });
  });

  describe('insertNotification', () => {
    it('inserts notification with valid type', async () => {
      const result = await insertNotification({
        userId: 'user-123',
        title: 'Payment Received',
        body: 'Your payment has been processed',
        notif_type: 'payment',
      });
      
      expect(result).toBeDefined();
    });

    it('inserts all allowed notif_types', async () => {
      for (const type of ALLOWED_NOTIF_TYPES) {
        await expect(
          insertNotification({
            userId: 'user-123',
            title: `Test ${type}`,
            body: 'Test body',
            notif_type: type,
          })
        ).resolves.not.toThrow();
      }
    });

    it('rejects notification with invalid type', async () => {
      await expect(
        insertNotification({
          userId: 'user-123',
          title: 'Bad',
          body: 'Bad type',
          notif_type: 'not_a_real_type',
        })
      ).rejects.toThrow();
    });
  });
});

describe('Notification Type Allowlist', () => {
  describe('ALLOWED_NOTIF_TYPES', () => {
    it('contains all 10 required types', () => {
      expect(ALLOWED_NOTIF_TYPES.size).toBe(10);
    });

    it('includes order_update', () => {
      expect(ALLOWED_NOTIF_TYPES.has('order_update')).toBe(true);
    });

    it('includes payment', () => {
      expect(ALLOWED_NOTIF_TYPES.has('payment')).toBe(true);
    });

    it('includes load_offer', () => {
      expect(ALLOWED_NOTIF_TYPES.has('load_offer')).toBe(true);
    });

    it('includes trip_update', () => {
      expect(ALLOWED_NOTIF_TYPES.has('trip_update')).toBe(true);
    });

    it('includes document', () => {
      expect(ALLOWED_NOTIF_TYPES.has('document')).toBe(true);
    });

    it('includes system', () => {
      expect(ALLOWED_NOTIF_TYPES.has('system')).toBe(true);
    });

    it('includes bid_accepted (issue #7538)', () => {
      expect(ALLOWED_NOTIF_TYPES.has('bid_accepted')).toBe(true);
    });

    it('includes new_bid (issue #7538)', () => {
      expect(ALLOWED_NOTIF_TYPES.has('new_bid')).toBe(true);
    });

    it('includes payment_locked (issue #7538)', () => {
      expect(ALLOWED_NOTIF_TYPES.has('payment_locked')).toBe(true);
    });

    it('includes payment_released (issue #7538)', () => {
      expect(ALLOWED_NOTIF_TYPES.has('payment_released')).toBe(true);
    });
  });

  describe('validateNotifType', () => {
    it('returns valid for all allowed types', () => {
      for (const type of ALLOWED_NOTIF_TYPES) {
        const result = validateNotifType(type);
        expect(result.valid).toBe(true);
        expect(result.normalized).toBe(type);
      }
    });

    it('returns invalid for unknown types', () => {
      const result = validateNotifType('unknown_type');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid notif_type');
    });

    it('returns invalid for empty string', () => {
      const result = validateNotifType('');
      expect(result.valid).toBe(false);
    });

    it('returns invalid for null', () => {
      const result = validateNotifType(null);
      expect(result.valid).toBe(false);
    });

    it('returns invalid for undefined', () => {
      const result = validateNotifType(undefined);
      expect(result.valid).toBe(false);
    });

    it('normalizes case (case-insensitive)', () => {
      const result = validateNotifType('ORDER_UPDATE');
      expect(result.valid).toBe(true);
      expect(result.normalized).toBe('order_update');
    });

    it('trims whitespace', () => {
      const result = validateNotifType('  payment  ');
      expect(result.valid).toBe(true);
      expect(result.normalized).toBe('payment');
    });
  });

  describe('FCM_ENABLED_TYPES', () => {
    it('is a subset of ALLOWED_NOTIF_TYPES', () => {
      for (const type of FCM_ENABLED_TYPES) {
        expect(ALLOWED_NOTIF_TYPES.has(type)).toBe(true);
      }
    });

    it('includes high-priority types', () => {
      expect(FCM_ENABLED_TYPES.has('payment')).toBe(true);
      expect(FCM_ENABLED_TYPES.has('bid_accepted')).toBe(true);
    });
  });

  describe('HIGH_PRIORITY_TYPES', () => {
    it('is a subset of FCM_ENABLED_TYPES', () => {
      for (const type of HIGH_PRIORITY_TYPES) {
        expect(FCM_ENABLED_TYPES.has(type)).toBe(true);
      }
    });

    it('includes payment-related types', () => {
      expect(HIGH_PRIORITY_TYPES.has('payment')).toBe(true);
      expect(HIGH_PRIORITY_TYPES.has('payment_locked')).toBe(true);
      expect(HIGH_PRIORITY_TYPES.has('payment_released')).toBe(true);
    });
  });
});
