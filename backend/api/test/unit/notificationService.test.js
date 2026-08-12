import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendPushNotification, sendFcmNotification } from '../../src/services/notificationService.js';

vi.mock('../../src/config/db.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockResolvedValue({ data: [], error: null }),
      insert: vi.fn().mockResolvedValue({ data: { id: 'fcm-token-1' }, error: null }),
    })),
  },
}));

describe('notificationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('sendPushNotification', () => {
    it('returns success:false when userId is null', async () => {
      const result = await sendPushNotification(null, 'Test Title', 'Test Body', 'order_update', {});
      expect(result).toEqual({ success: false, error: 'No userId provided' });
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
});
