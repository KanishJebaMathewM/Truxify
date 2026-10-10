import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
  sendPushNotification, 
  sendFcmNotification, 
  sendOtpNotification 
} from '../../../src/services/notificationService.js';

// Mock underlying firebase-admin or notification transport providers
vi.mock('firebase-admin/messaging', () => ({
  getMessaging: vi.fn(() => ({
    send: vi.fn().mockResolvedValue('projects/truxify/messages/mock-msg-id'),
    sendEachForMulticast: vi.fn().mockResolvedValue({
      successCount: 2,
      failureCount: 0,
      responses: [{ success: true }, { success: true }],
    }),
  })),
}));

describe('NotificationService (Module Functions)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('sendPushNotification', () => {
    it('successfully dispatches a single push notification with correct payload', async () => {
      const token = 'mock-fcm-token-123';
      const payload = {
        title: 'Shipment Dispatched',
        body: 'Your truck TN-01-AX-9821 is en route.',
        data: { shipmentId: 'SHP-9921' },
      };

      const result = await sendPushNotification(token, payload);

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.messageId).toBe('projects/truxify/messages/mock-msg-id');
    });

    it('handles dispatch failure gracefully when token is invalid', async () => {
      // Test error propagation or fail-safe handling
      const invalidToken = '';
      const payload = { title: 'Test', body: 'Test' };

      await expect(sendPushNotification(invalidToken, payload)).rejects.toThrow();
    });
  });

  describe('sendFcmNotification (Multicast)', () => {
    it('dispatches bulk notifications across multiple devices successfully', async () => {
      const tokens = ['token-1', 'token-2'];
      const payload = {
        title: 'Toll Plaza Passed',
        body: 'Verified by WIM sensor.',
      };

      const result = await sendFcmNotification(tokens, payload);

      expect(result).toBeDefined();
      expect(result.successCount).toBe(2);
      expect(result.failureCount).toBe(0);
    });
  });

  describe('sendOtpNotification', () => {
    it('formats and sends OTP verification codes securely', async () => {
      const phoneNumber = '+919876543210';
      const otpCode = '482910';

      const result = await sendOtpNotification(phoneNumber, otpCode);

      expect(result).toBeDefined();
      expect(result.delivered).toBe(true);
import { NotificationService } from '../../../src/services/notificationService.js';

// Mock logger and database dependencies
vi.mock('../../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('../../../src/config/database.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      insert: vi.fn().mockResolvedValue({ data: [], error: null }),
    })),
  },
}));

describe('NotificationService', () => {
  let notificationService;

  beforeEach(() => {
    vi.clearAllMocks();
    notificationService = new NotificationService();
  });

  describe('sendNotification', () => {
    it('should successfully dispatch notification via the specified channel (e.g., push)', async () => {
      const recipient = { userId: 'user-123', pushToken: 'token-abc' };
      const payload = { title: 'Order Update', body: 'Your delivery has been assigned.' };

      vi.spyOn(notificationService, 'dispatchPush').mockResolvedValue(true);

      const result = await notificationService.sendNotification(recipient, payload, 'push');

      expect(result.success).toBe(true);
      expect(notificationService.dispatchPush).toHaveBeenCalledWith(recipient.pushToken, payload);
    });

    it('should handle channel failures gracefully and return error without blocking execution', async () => {
      const recipient = { userId: 'user-123', email: 'driver@truxify.com' };
      const payload = { title: 'Alert', body: 'Test message' };

      vi.spyOn(notificationService, 'dispatchEmail').mockRejectedValue(new Error('SMTP connection timeout'));

      const result = await notificationService.sendNotification(recipient, payload, 'email');

      expect(result.success).toBe(false);
      expect(result.error).toContain('SMTP connection timeout');
    });
  });

  describe('sendBulkNotifications', () => {
    it('should process multiple recipients and handle partial/total channel failures independently', async () => {
      const recipients = [
        { userId: 'user-1', pushToken: 'token-1' },
        { userId: 'user-2', pushToken: 'token-2' },
      ];
      const payload = { title: 'Broadcast', body: 'System maintenance notice' };

      vi.spyOn(notificationService, 'sendNotification')
        .mockResolvedValueOnce({ success: true, userId: 'user-1' })
        .mockResolvedValueOnce({ success: false, error: 'Invalid token', userId: 'user-2' });

      const results = await notificationService.sendBulkNotifications(recipients, payload, 'push');

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
    });
  });

  describe('Retry Logic', () => {
    it('should retry transient channel failures up to max attempts before succeeding', async () => {
      const recipient = { userId: 'user-123', email: 'driver@truxify.com' };
      const payload = { title: 'Test', body: 'Retry test' };

      const mockDispatch = vi.spyOn(notificationService, 'dispatchEmail')
        .mockRejectedValueOnce(new Error('Temporary network error'))
        .mockRejectedValueOnce(new Error('Temporary network error'))
        .mockResolvedValueOnce(true);

      const result = await notificationService.sendWithRetry(recipient, payload, 'email', 3);

      expect(result.success).toBe(true);
      expect(mockDispatch).toHaveBeenCalledTimes(3);
    });

    it('should fail after exhausting all retry attempts', async () => {
      const recipient = { userId: 'user-123', email: 'driver@truxify.com' };
      const payload = { title: 'Test', body: 'Persistent failure' };

      vi.spyOn(notificationService, 'dispatchEmail')
        .mockRejectedValue(new Error('Permanent service down'));

      const result = await notificationService.sendWithRetry(recipient, payload, 'email', 2);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Permanent service down');
    });
  });
});
