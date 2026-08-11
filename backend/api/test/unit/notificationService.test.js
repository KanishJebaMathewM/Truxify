import { describe, it, expect, vi, beforeEach } from 'vitest';
import notificationService from '../../src/services/notificationService.js';
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
