import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetActiveDeliveryOtp = vi.fn();
const mockStoreDeliveryOtp = vi.fn();
const mockSendDeliveryOtpNotification = vi.fn();

vi.mock('../../src/config/db.js', () => ({
  redisClient: {
    get: vi.fn().mockResolvedValue(null),
    del: vi.fn(),
    incr: vi.fn(),
    expire: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock('../../src/services/notificationService.js', () => ({
  sendDeliveryOtpNotification: mockSendDeliveryOtpNotification,
  storeDeliveryOtp: mockStoreDeliveryOtp,
  getActiveDeliveryOtp: mockGetActiveDeliveryOtp,
}));

const mockOrderRepository = {
  updateOrder: vi.fn(),
};

describe('orderNotificationService', () => {
  let orderNotificationService;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const { OrderNotificationService } = await import('../../src/services/order/orderNotificationService.js');
    orderNotificationService = new OrderNotificationService(mockOrderRepository);
  });

  describe('sendOrderNotification', () => {
    it('issues a fresh OTP and dispatches it', async () => {
      mockGetActiveDeliveryOtp.mockResolvedValue(null);
      mockStoreDeliveryOtp.mockResolvedValue(true);
      mockSendDeliveryOtpNotification.mockResolvedValue({ success: true });

      const result = await orderNotificationService.sendOrderNotification({
        type: 'delivery_otp_in_transit',
        orderId: 'order-1',
        orderDisplayId: 'TRX-1',
        customerId: 'cust-1',
      });

      expect(result.notified).toBe(true);
      expect(result.otp).toMatch(/^\d{6}$/);
      expect(mockStoreDeliveryOtp).toHaveBeenCalledWith('order-1', result.otp, expect.any(Number));
      expect(mockSendDeliveryOtpNotification).toHaveBeenCalledWith('cust-1', 'TRX-1', result.otp);
      expect(mockOrderRepository.updateOrder).not.toHaveBeenCalled();
    });

    it('does not regenerate while an active OTP exists', async () => {
      mockGetActiveDeliveryOtp.mockResolvedValue({ otp: '111111' });

      const result = await orderNotificationService.sendOrderNotification({
        type: 'delivery_otp_in_transit',
        orderId: 'order-1',
        orderDisplayId: 'TRX-1',
        customerId: 'cust-1',
      });

      expect(result).toEqual({ otp: null, notified: false });
      expect(mockStoreDeliveryOtp).not.toHaveBeenCalled();
    });

    it('handles a failed FCM dispatch without throwing', async () => {
      mockGetActiveDeliveryOtp.mockResolvedValue(null);
      mockStoreDeliveryOtp.mockResolvedValue(true);
      mockSendDeliveryOtpNotification.mockResolvedValue({ success: false, fcm: { error: 'device offline' } });

      const result = await orderNotificationService.sendOrderNotification({
        type: 'delivery_otp_in_transit',
        orderId: 'order-1',
        orderDisplayId: 'TRX-1',
        customerId: 'cust-1',
      });

      expect(result.notified).toBe(false);
      expect(mockOrderRepository.updateOrder).toHaveBeenCalledWith('order-1', expect.objectContaining({ updated_at: expect.any(String) }));
    });
  });
});
