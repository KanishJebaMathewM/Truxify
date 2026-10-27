/**
 * @fileoverview Unit tests for services/notificationService.js
 * Resolves Issue #12253: Add unit tests for NotificationService covering
 * sendNotification and sendBulkNotifications (FCM fan-out), including
 * channel dispatch, failure handling, and retry logic.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createSupabaseMock } from '../../helpers/supabaseMock.js';

// ─── In-memory mocks ─────────────────────────────────────────────────────────

const supabaseMock = createSupabaseMock();

const firebaseMock = {
  sendEachForMulticast: vi.fn(),
  send: vi.fn(),
};

const mockRedis = {
  publish: vi.fn().mockResolvedValue(1),
};

// ─── Module mocks (must be declared before any dynamic import) ────────────────

vi.mock('../../../src/config/db.js', () => ({
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

vi.mock('../../../src/middleware/logger.js', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../../src/core/performanceMetrics.js', () => ({
  measureExecution: vi.fn((_name, fn) => fn()),
}));

// ─── Service under test (dynamic import after mocks are registered) ───────────

const {
  sendNotification,
  sendFcmNotification,
  sendPushNotification,
  sendToDevice,
  publishNotification,
  publishNotificationEvent,
  insertNotification,
} = await import('../../../src/services/notificationService.js');

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Build a successful FCM BatchResponse for the given token list */
function okBatch(tokens) {
  return {
    responses: tokens.map((_t, i) => ({ success: true, messageId: `msg-${i}` })),
  };
}

/** Populate the in-memory user_devices table */
function seedDevices(rows) {
  supabaseMock.store.user_devices = rows.map((r, i) => ({
    id: r.id ?? `device-${i}`,
    fcm_token: r.fcm_token,
    user_id: r.user_id ?? 'user-1',
    platform: r.platform ?? 'android',
    device_id: r.device_id ?? null,
    is_active: r.is_active ?? true,
    deactivated_at:
      r.deactivated_at ?? (r.is_active === false ? new Date().toISOString() : null),
  }));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('NotificationService (#12253)', () => {
  beforeEach(() => {
    supabaseMock.reset();
    firebaseMock.sendEachForMulticast.mockReset();
    firebaseMock.send.mockReset();
    mockRedis.publish.mockReset().mockResolvedValue(1);
    supabaseMock.store.profiles = [{ id: 'user-1', fcm_token: null }];
  });

  // ===========================================================================
  // sendNotification — per-device granular delivery
  // ===========================================================================

  describe('sendNotification — per-device delivery', () => {
    it('delivers to a single active device and returns one result entry', async () => {
      seedDevices([{ id: 'dev-1', fcm_token: 'token-1' }]);
      firebaseMock.send.mockResolvedValue('msg-ok');

      const results = await sendNotification('user-1', {
        notification: { title: 'Hello', body: 'World' },
      });

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(results[0].deviceId).toBe('dev-1');
      expect(firebaseMock.send).toHaveBeenCalledTimes(1);
    });

    it('delivers to ALL active devices and returns one result per device', async () => {
      seedDevices([
        { id: 'dev-1', fcm_token: 'token-1' },
        { id: 'dev-2', fcm_token: 'token-2' },
        { id: 'dev-3', fcm_token: 'token-3' },
      ]);
      firebaseMock.send.mockResolvedValue('msg-id-ok');

      const results = await sendNotification('user-1', {
        notification: { title: 'Bulk', body: 'All devices' },
      });

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.success)).toBe(true);
      expect(firebaseMock.send).toHaveBeenCalledTimes(3);
    });

    it('publishes the payload to the Redis notifications channel', async () => {
      seedDevices([{ id: 'dev-1', fcm_token: 'token-1' }]);
      firebaseMock.send.mockResolvedValue('msg-id-ok');

      const payload = { notification: { title: 'Event', body: 'Triggered' } };
      await sendNotification('user-1', payload);

      expect(mockRedis.publish).toHaveBeenCalledWith(
        'notifications',
        JSON.stringify(payload),
      );
    });

    it('skips duplicate tokens — same physical token targeted only once', async () => {
      seedDevices([
        { id: 'dev-a', fcm_token: 'dup-token' },
        { id: 'dev-b', fcm_token: 'dup-token' },
      ]);
      firebaseMock.send.mockResolvedValue('msg-dedup');

      const results = await sendNotification('user-1', {
        notification: { title: 'Dedup', body: 'Test' },
      });

      // Only one send despite two devices sharing the same token
      expect(firebaseMock.send).toHaveBeenCalledTimes(1);
      expect(results).toHaveLength(1);
    });

    it('falls back to profile-level token when no active device rows exist', async () => {
      supabaseMock.store.user_devices = [];
      supabaseMock.store.profiles = [{ id: 'user-1', fcm_token: 'profile-token' }];
      firebaseMock.send.mockResolvedValue('msg-profile');

      const results = await sendNotification('user-1', {
        notification: { title: 'Fallback', body: 'Test' },
      });

      expect(results).toHaveLength(1);
      expect(results[0].deviceId).toBe('profile-fallback');
      expect(results[0].success).toBe(true);
    });

    it('returns an empty array when no tokens exist at all', async () => {
      supabaseMock.store.user_devices = [];
      supabaseMock.store.profiles = [{ id: 'user-1', fcm_token: null }];

      const results = await sendNotification('user-1', {
        notification: { title: 'Nobody', body: 'Home' },
      });

      expect(results).toHaveLength(0);
      expect(firebaseMock.send).not.toHaveBeenCalled();
    });

    // ── Channel failure handling ──────────────────────────────────────────────

    it('marks result as failed when FCM send throws a transient error', async () => {
      seedDevices([{ id: 'dev-1', fcm_token: 'token-1' }]);
      const err = new Error('Service Unavailable');
      err.code = 'messaging/unavailable';
      firebaseMock.send.mockRejectedValue(err);

      const results = await sendNotification('user-1', {
        notification: { title: 'Fail', body: 'Test' },
      });

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toBe('messaging/unavailable');
    });

    it('deactivates device when FCM reports a permanent token error', async () => {
      seedDevices([{ id: 'dev-bad', fcm_token: 'bad-token' }]);
      const err = new Error('Token not registered');
      err.code = 'messaging/registration-token-not-registered';
      firebaseMock.send.mockRejectedValue(err);

      const results = await sendNotification('user-1', {
        notification: { title: 'Perm', body: 'Fail' },
      });

      expect(results[0].success).toBe(false);
      const device = supabaseMock.store.user_devices.find((d) => d.id === 'dev-bad');
      expect(device.is_active).toBe(false);
    });

    it('keeps device active when FCM reports a transient error (no deactivation)', async () => {
      seedDevices([{ id: 'dev-1', fcm_token: 'token-1' }]);
      const err = new Error('Internal error');
      err.code = 'messaging/internal-error';
      firebaseMock.send.mockRejectedValue(err);

      await sendNotification('user-1', { notification: { title: 'T', body: 'T' } });

      const device = supabaseMock.store.user_devices.find((d) => d.id === 'dev-1');
      expect(device.is_active).toBe(true);
    });

    it('continues delivering to remaining devices even if one channel fails', async () => {
      seedDevices([
        { id: 'dev-ok', fcm_token: 'token-ok' },
        { id: 'dev-bad', fcm_token: 'token-bad' },
      ]);
      firebaseMock.send.mockImplementation(({ token }) => {
        if (token === 'token-bad') return Promise.reject(new Error('FCM error'));
        return Promise.resolve('msg-ok');
      });

      const results = await sendNotification('user-1', {
        notification: { title: 'Mix', body: 'Test' },
      });

      expect(results).toHaveLength(2);
      const ok = results.find((r) => r.deviceId === 'dev-ok');
      const bad = results.find((r) => r.deviceId === 'dev-bad');
      expect(ok.success).toBe(true);
      expect(bad.success).toBe(false);
    });

    it('continues device delivery even if Redis publish throws an error', async () => {
      seedDevices([{ id: 'dev-1', fcm_token: 'token-1' }]);
      firebaseMock.send.mockResolvedValue('msg-ok');
      mockRedis.publish.mockRejectedValueOnce(new Error('Redis down'));

      const results = await sendNotification('user-1', {
        notification: { title: 'Redis fail', body: 'Test' },
      });

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
    });
  });

  // ===========================================================================
  // sendFcmNotification — bulk fan-out via sendEachForMulticast
  // Acts as "sendBulkNotifications": batches all device tokens into FCM
  // multicast requests capped at 500 per batch.
  // ===========================================================================

  describe('sendFcmNotification — bulk multicast fan-out (sendBulkNotifications)', () => {
    it('sends a multicast batch to a single device token', async () => {
      seedDevices([{ fcm_token: 'token-a' }]);
      firebaseMock.sendEachForMulticast.mockResolvedValue(okBatch(['token-a']));

      const result = await sendFcmNotification(
        'user-1',
        { title: 'Hi', body: 'There' },
        {},
      );

      expect(firebaseMock.sendEachForMulticast).toHaveBeenCalledTimes(1);
      const call = firebaseMock.sendEachForMulticast.mock.calls[0][0];
      expect(call.tokens).toEqual(['token-a']);
      expect(call.notification).toEqual({ title: 'Hi', body: 'There' });
      expect(result.success).toBe(true);
      expect(result.summary.delivered).toBe(1);
    });

    it('fans out to all active devices in a single multicast batch', async () => {
      seedDevices([
        { fcm_token: 'token-a' },
        { fcm_token: 'token-b' },
        { fcm_token: 'token-c' },
      ]);
      firebaseMock.sendEachForMulticast.mockResolvedValue(
        okBatch(['token-a', 'token-b', 'token-c']),
      );

      const result = await sendFcmNotification(
        'user-1',
        { title: 'Bulk', body: 'All' },
        {},
      );

      expect(firebaseMock.sendEachForMulticast).toHaveBeenCalledTimes(1);
      expect(result.summary.delivered).toBe(3);
      expect(result.summary.uniqueTokens).toBe(3);
      expect(result.summary.devicesFound).toBe(3);
    });

    it('chunks fan-out into multiple batches when token count exceeds SDK limit (500)', async () => {
      const manyDevices = Array.from({ length: 501 }, (_, i) => ({
        fcm_token: `token-${i}`,
      }));
      seedDevices(manyDevices);
      firebaseMock.sendEachForMulticast.mockImplementation(async ({ tokens }) =>
        okBatch(tokens),
      );

      const result = await sendFcmNotification(
        'user-1',
        { title: 'Big', body: 'Blast' },
        {},
      );

      expect(firebaseMock.sendEachForMulticast).toHaveBeenCalledTimes(2);
      expect(firebaseMock.sendEachForMulticast.mock.calls[0][0].tokens).toHaveLength(500);
      expect(firebaseMock.sendEachForMulticast.mock.calls[1][0].tokens).toHaveLength(1);
      expect(result.summary.batches).toBe(2);
      expect(result.summary.delivered).toBe(501);
    });

    it('deduplicates identical tokens before multicast — same token not sent twice', async () => {
      seedDevices([
        { fcm_token: 'dup-token' },
        { fcm_token: 'dup-token' },
      ]);
      firebaseMock.sendEachForMulticast.mockResolvedValue(okBatch(['dup-token']));

      const result = await sendFcmNotification(
        'user-1',
        { title: 'Dedup', body: 'Test' },
        {},
      );

      expect(firebaseMock.sendEachForMulticast).toHaveBeenCalledTimes(1);
      expect(firebaseMock.sendEachForMulticast.mock.calls[0][0].tokens).toEqual([
        'dup-token',
      ]);
      expect(result.summary.uniqueTokens).toBe(1);
      expect(result.summary.delivered).toBe(1);
    });

    it('ignores inactive devices when building the batch token list', async () => {
      seedDevices([
        { fcm_token: 'active-token', is_active: true },
        { fcm_token: 'inactive-token', is_active: false },
      ]);
      firebaseMock.sendEachForMulticast.mockResolvedValue(okBatch(['active-token']));

      const result = await sendFcmNotification(
        'user-1',
        { title: 'Filter', body: 'Test' },
        {},
      );

      expect(firebaseMock.sendEachForMulticast.mock.calls[0][0].tokens).toEqual([
        'active-token',
      ]);
      expect(result.summary.uniqueTokens).toBe(1);
    });

    it('falls back to profile token when no active device rows exist', async () => {
      supabaseMock.store.user_devices = [];
      supabaseMock.store.profiles = [{ id: 'user-1', fcm_token: 'profile-token' }];
      firebaseMock.sendEachForMulticast.mockResolvedValue(okBatch(['profile-token']));

      const result = await sendFcmNotification(
        'user-1',
        { title: 'Fallback', body: 'Test' },
        {},
      );

      expect(firebaseMock.sendEachForMulticast.mock.calls[0][0].tokens).toEqual([
        'profile-token',
      ]);
      expect(result.success).toBe(true);
    });

    it('returns NO_FCM_TOKEN failure when no device or profile token exists', async () => {
      supabaseMock.store.user_devices = [];
      supabaseMock.store.profiles = [{ id: 'user-1', fcm_token: null }];

      const result = await sendFcmNotification(
        'user-1',
        { title: 'None', body: 'Test' },
        {},
      );

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('NO_FCM_TOKEN');
      expect(firebaseMock.sendEachForMulticast).not.toHaveBeenCalled();
    });

    // ── Channel failure handling ──────────────────────────────────────────────

    it('deactivates permanently-invalid device while still delivering to a valid one', async () => {
      seedDevices([
        { id: 'dev-invalid', fcm_token: 'token-invalid' },
        { id: 'dev-valid', fcm_token: 'token-valid' },
      ]);
      firebaseMock.sendEachForMulticast.mockResolvedValue({
        responses: [
          {
            success: false,
            error: { code: 'messaging/registration-token-not-registered' },
          },
          { success: true, messageId: 'msg-valid' },
        ],
      });

      const result = await sendFcmNotification(
        'user-1',
        { title: 'Partial', body: 'Test' },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.summary.delivered).toBe(1);
      expect(result.summary.permanent).toBe(1);
      expect(result.summary.deactivated).toBe(1);

      const invalidDev = supabaseMock.store.user_devices.find(
        (d) => d.id === 'dev-invalid',
      );
      const validDev = supabaseMock.store.user_devices.find(
        (d) => d.id === 'dev-valid',
      );
      expect(invalidDev.is_active).toBe(false);
      expect(validDev.is_active).toBe(true);
    });

    it('keeps device active on transient FCM error — no deactivation', async () => {
      seedDevices([{ id: 'dev-1', fcm_token: 'token-1' }]);
      firebaseMock.sendEachForMulticast.mockResolvedValue({
        responses: [{ success: false, error: { code: 'messaging/unavailable' } }],
      });

      const result = await sendFcmNotification(
        'user-1',
        { title: 'Transient', body: 'Test' },
        {},
      );

      expect(result.success).toBe(false);
      expect(result.summary.transient).toBe(1);
      expect(result.summary.deactivated).toBe(0);
      const dev = supabaseMock.store.user_devices.find((d) => d.id === 'dev-1');
      expect(dev.is_active).toBe(true);
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
          {
            success: false,
            error: { code: 'messaging/registration-token-not-registered' },
          },
          { success: false, error: { code: 'messaging/unavailable' } },
        ],
      });

      const result = await sendFcmNotification(
        'user-1',
        { title: 'Mix', body: 'Test' },
        {},
      );

      expect(result.success).toBe(true);
      expect(result.summary.delivered).toBe(1);
      expect(result.summary.permanent).toBe(1);
      expect(result.summary.transient).toBe(1);
      expect(result.messageId).toBe('msg-a');
    });

    // ── Retry logic ──────────────────────────────────────────────────────────

    it('retries up to MAX_RETRIES (3) times on whole-batch transient transport failures', async () => {
      seedDevices([{ fcm_token: 'token-a' }]);
      const transientErr = new Error('Service Unavailable');
      transientErr.code = 'messaging/unavailable';
      firebaseMock.sendEachForMulticast.mockRejectedValue(transientErr);

      const result = await sendFcmNotification(
        'user-1',
        { title: 'Retry', body: 'Test' },
        {},
      );

      expect(firebaseMock.sendEachForMulticast).toHaveBeenCalledTimes(3);
      expect(result.success).toBe(false);
      expect(result.summary.transient).toBe(1);
      expect(result.summary.delivered).toBe(0);
      expect(result.summary.deactivated).toBe(0);
    });

    it('succeeds on retry when first attempt is transient and second attempt succeeds', async () => {
      seedDevices([{ fcm_token: 'token-a' }]);
      const transientErr = new Error('Internal Error');
      transientErr.code = 'messaging/internal-error';
      firebaseMock.sendEachForMulticast
        .mockRejectedValueOnce(transientErr)
        .mockResolvedValueOnce(okBatch(['token-a']));

      const result = await sendFcmNotification(
        'user-1',
        { title: 'Retry Success', body: 'Test' },
        {},
      );

      expect(firebaseMock.sendEachForMulticast).toHaveBeenCalledTimes(2);
      expect(result.success).toBe(true);
      expect(result.summary.delivered).toBe(1);
    });

    it('does NOT retry on permanent token errors — fails immediately for that batch', async () => {
      seedDevices([{ fcm_token: 'token-perm' }]);
      const permErr = new Error('Invalid token');
      permErr.code = 'messaging/registration-token-not-registered';
      firebaseMock.sendEachForMulticast.mockRejectedValue(permErr);

      const result = await sendFcmNotification(
        'user-1',
        { title: 'Perm Fail', body: 'Test' },
        {},
      );

      // Permanent batch-level errors are not retried
      expect(firebaseMock.sendEachForMulticast).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(false);
    });

    it('returns FCM_NOT_CONFIGURED when Firebase messaging is not set up', async () => {
      const dbModule = await import('../../../src/config/db.js');
      const original = dbModule.firebaseAdmin.messaging;
      dbModule.firebaseAdmin.messaging = null;

      try {
        const result = await sendFcmNotification(
          'user-1',
          { title: 'NoFB', body: 'Test' },
          {},
        );
        expect(result.success).toBe(false);
        expect(result.errorCode).toBe('FCM_NOT_CONFIGURED');
      } finally {
        dbModule.firebaseAdmin.messaging = original;
      }
    });
  });

  // ===========================================================================
  // sendPushNotification — orchestration: DB persist + FCM fan-out
  // ===========================================================================

  describe('sendPushNotification — orchestration', () => {
    it('persists the notification row and delivers via FCM fan-out', async () => {
      seedDevices([{ fcm_token: 'token-a' }]);
      firebaseMock.sendEachForMulticast.mockResolvedValue(okBatch(['token-a']));

      const result = await sendPushNotification(
        'user-1',
        'Order updated',
        'Your cargo is en route',
        'order_update',
        { order_display_id: 'ORD-9999' },
      );

      const persisted = supabaseMock.store.notifications?.find(
        (n) => n.user_id === 'user-1',
      );
      expect(persisted).toBeTruthy();
      expect(persisted.notif_type).toBe('order_update');
      expect(persisted.metadata).toEqual({ order_display_id: 'ORD-9999' });
      expect(result.success).toBe(true);
    });

    it('throws DomainError for an invalid notif_type before any side-effects', async () => {
      const { DomainError } = await import(
        '../../../src/services/order/domainError.js'
      );
      await expect(
        sendPushNotification('user-1', 'Title', 'Body', 'unsupported_xyz', {}),
      ).rejects.toThrow(DomainError);
      expect(supabaseMock.store.notifications ?? []).toHaveLength(0);
      expect(firebaseMock.sendEachForMulticast).not.toHaveBeenCalled();
    });

    it('continues FCM delivery even when database insert fails', async () => {
      seedDevices([{ fcm_token: 'token-a' }]);
      firebaseMock.sendEachForMulticast.mockResolvedValue(okBatch(['token-a']));
      supabaseMock.programErrorFor('notifications', 'insert', 'DB write failure');

      const result = await sendPushNotification(
        'user-1',
        'Tripwire',
        'DB failed but FCM should proceed',
        'order_update',
        {},
      );

      expect(firebaseMock.sendEachForMulticast).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
    });

    it('returns success:false when FCM fails but DB insert succeeds', async () => {
      seedDevices([{ fcm_token: 'token-a' }]);
      firebaseMock.sendEachForMulticast.mockRejectedValue(new Error('FCM down'));

      const result = await sendPushNotification(
        'user-1',
        'Alert',
        'Something happened',
        'order_update',
        {},
      );

      expect(result.success).toBe(false);
      expect(supabaseMock.store.notifications).toHaveLength(1);
    });
  });

  // ===========================================================================
  // insertNotification — allowlist validation
  // ===========================================================================

  describe('insertNotification — channel allowlist validation', () => {
    it('persists notification row for a valid notif_type', async () => {
      const row = await insertNotification({
        notif_type: 'payment',
        user_id: 'user-1',
        title: 'Payment received',
        body: 'Your payment was processed.',
      });
      expect(row).toBeTruthy();
      const persisted = supabaseMock.store.notifications?.find(
        (n) => n.notif_type === 'payment',
      );
      expect(persisted).toBeTruthy();
    });

    it('throws DomainError for an invalid notif_type (channel validation)', async () => {
      const { DomainError } = await import(
        '../../../src/services/order/domainError.js'
      );
      await expect(
        insertNotification({ notif_type: 'not_a_channel', user_id: 'user-1' }),
      ).rejects.toThrow(DomainError);
    });

    it('returns null and does not throw when DB insert fails', async () => {
      supabaseMock.programError('Connection reset');
      const row = await insertNotification({
        notif_type: 'order_update',
        user_id: 'user-1',
      });
      expect(row).toBeNull();
    });
  });

  // ===========================================================================
  // publishNotification / publishNotificationEvent — Redis channel dispatch
  // ===========================================================================

  describe('publishNotification — Redis channel dispatch', () => {
    it('publishes payload to the notifications Redis channel and returns true', async () => {
      const payload = { event: 'order.updated', orderId: 'ORD-001' };
      const result = await publishNotification(payload);
      expect(result).toBe(true);
      expect(mockRedis.publish).toHaveBeenCalledWith(
        'notifications',
        JSON.stringify(payload),
      );
    });

    it('publishNotificationEvent alias dispatches identically to publishNotification', async () => {
      const payload = { event: 'payment.locked' };
      const result = await publishNotificationEvent(payload);
      expect(result).toBe(true);
      expect(mockRedis.publish).toHaveBeenCalledWith(
        'notifications',
        JSON.stringify(payload),
      );
    });

    it('returns false and does not throw when Redis publish fails', async () => {
      mockRedis.publish.mockRejectedValueOnce(new Error('Redis connection lost'));
      const result = await publishNotification({ event: 'test' });
      expect(result).toBe(false);
    });
  });

  // ===========================================================================
  // sendToDevice — single-token channel dispatch
  // ===========================================================================

  describe('sendToDevice — single token channel dispatch', () => {
    it('dispatches a notification to a valid FCM token', async () => {
      firebaseMock.send.mockResolvedValue('msg-single');

      const result = await sendToDevice('valid-token', {
        notification: { title: 'Direct', body: 'Send' },
        data: { key: 'val' },
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('msg-single');
      expect(firebaseMock.send).toHaveBeenCalledWith({
        token: 'valid-token',
        notification: { title: 'Direct', body: 'Send' },
        data: { key: 'val' },
      });
    });

    it('returns failure for null token — invalid channel', async () => {
      const result = await sendToDevice(null, {});
      expect(result.success).toBe(false);
    });

    it('returns failure for empty string token — invalid channel', async () => {
      const result = await sendToDevice('', {});
      expect(result.success).toBe(false);
    });

    it('returns failure for non-string token — invalid channel', async () => {
      const result = await sendToDevice(12345, {});
      expect(result.success).toBe(false);
    });

    it('captures FCM error code on channel failure', async () => {
      const err = new Error('Bad token');
      err.code = 'messaging/invalid-registration-token';
      firebaseMock.send.mockRejectedValue(err);

      const result = await sendToDevice('bad-token', {});
      expect(result.success).toBe(false);
      expect(result.error).toBe('messaging/invalid-registration-token');
    });
  });
});
