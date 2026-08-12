import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendPushNotification, sendFcmNotification } from '../../src/services/notificationService.js';

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
});
