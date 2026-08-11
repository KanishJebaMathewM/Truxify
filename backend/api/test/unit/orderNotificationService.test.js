import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/notificationService.js', () => ({
  sendDeliveryOtpNotification: vi.fn(),
  storeDeliveryOtp: vi.fn(),
  getActiveDeliveryOtp: vi.fn(),
  verifyDeliveryOtp: vi.fn(),
  verifyDeliveryOtpHash: vi.fn(),
}));

import { sendDeliveryOtpNotification, storeDeliveryOtp, getActiveDeliveryOtp } from '../../src/services/notificationService.js';

const mockOrderRepository = {
  updateOrder: vi.fn(),
};

describe('orderNotificationService', () => {
  let orderNotificationService;

  beforeEach(async () => {
    vi.clearAllMocks();
    orderNotificationService = new (await import('../../src/services/order/orderNotificationService.js')).OrderNotificationService(mockOrderRepository);
  });

  describe('sendOrderNotification', () => {
    it('generates and dispatches a delivery OTP when none is active', async () => {
      getActiveDeliveryOtp.mockResolvedValue(null);
      storeDeliveryOtp.mockResolvedValue(true);
      sendDeliveryOtpNotification.mockResolvedValue({ success: true });

      const result = await orderNotificationService.sendOrderNotification({
        type: 'delivery_otp_in_transit',
        orderId: 'order-1',
        orderDisplayId: 'OD-1',
        customerId: 'customer-1',
      });

      expect(result.notified).toBe(true);
      expect(result.otp).toMatch(/^\d{6}$/);
      expect(sendDeliveryOtpNotification).toHaveBeenCalledWith('customer-1', 'OD-1', result.otp);
      expect(storeDeliveryOtp).toHaveBeenCalledWith('order-1', result.otp, expect.any(Number));
    });

    it('does not regenerate an OTP while one is still active', async () => {
      getActiveDeliveryOtp.mockResolvedValue({ id: 'otp-1', order_id: 'order-1' });

      const result = await orderNotificationService.sendOrderNotification({
        type: 'delivery_otp_in_transit',
        orderId: 'order-1',
        orderDisplayId: 'OD-1',
        customerId: 'customer-1',
      });

      expect(result).toEqual({ otp: null, notified: false });
      expect(storeDeliveryOtp).not.toHaveBeenCalled();
    });

    it('returns no OTP when the OTP could not be stored', async () => {
      getActiveDeliveryOtp.mockResolvedValue(null);
      storeDeliveryOtp.mockResolvedValue(false);

      const result = await orderNotificationService.sendOrderNotification({
        type: 'delivery_otp_resend',
        orderId: 'order-1',
        orderDisplayId: 'OD-1',
        customerId: 'customer-1',
      });

      expect(result).toEqual({ otp: null, notified: false });
    });

    it('reports a failed notification but still returns the generated OTP', async () => {
      getActiveDeliveryOtp.mockResolvedValue(null);
      storeDeliveryOtp.mockResolvedValue(true);
      sendDeliveryOtpNotification.mockResolvedValue({ success: false, fcm: { error: 'token invalid' } });

      const result = await orderNotificationService.sendOrderNotification({
        type: 'delivery_otp_in_transit',
        orderId: 'order-1',
        orderDisplayId: 'OD-1',
        customerId: 'customer-1',
      });

      expect(result.notified).toBe(false);
      expect(result.otp).toMatch(/^\d{6}$/);
      expect(mockOrderRepository.updateOrder).toHaveBeenCalledWith('order-1', expect.objectContaining({ updated_at: expect.any(String) }));
    });
  });
});
