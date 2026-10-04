import { describe, it, expect, vi, beforeEach } from 'vitest';
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
