import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockNotificationDispatcher = vi.fn();

vi.mock('../../src/core/container.js', () => ({
  notificationDispatcher: mockNotificationDispatcher,
}));

describe('orderNotificationService', () => {
  let orderNotificationService;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    orderNotificationService = (await import('../../src/services/order/orderNotificationService.js')).default;
  });

  describe('sendOrderUpdate', () => {
    it('dispatches notification with order update', async () => {
      mockNotificationDispatcher.mockResolvedValue({ success: true });
      await orderNotificationService.sendOrderUpdate('driver-1', 'order-1', 'Order started');
      expect(mockNotificationDispatcher).toHaveBeenCalledWith(
        'driver-1',
        expect.stringContaining('order-1'),
        expect.any(String),
        expect.any(Object),
      );
    });

    it('gracefully handles dispatcher failure', async () => {
      mockNotificationDispatcher.mockRejectedValue(new Error('Dispatcher unavailable'));
      // Should not throw
      await expect(
        orderNotificationService.sendOrderUpdate('driver-1', 'order-1', 'Update'),
      ).resolves.not.toThrow();
    });
  });

  describe('sendBidReceived', () => {
    it('dispatches bid received notification', async () => {
      mockNotificationDispatcher.mockResolvedValue({ success: true });
      await orderNotificationService.sendBidReceived('customer-1', 'bid-1', 15000);
      expect(mockNotificationDispatcher).toHaveBeenCalled();
    });
  });

  describe('sendDeliveryConfirmed', () => {
    it('dispatches delivery confirmed notification', async () => {
      mockNotificationDispatcher.mockResolvedValue({ success: true });
      await orderNotificationService.sendDeliveryConfirmed('customer-1', 'order-1');
      expect(mockNotificationDispatcher).toHaveBeenCalled();
    });
  });
});
