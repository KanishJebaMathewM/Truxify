import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockOrderRepository = {
  findOrderById: vi.fn(),
};

const mockNotificationService = {
  getActiveDeliveryOtp: vi.fn(),
  verifyDeliveryOtpHash: vi.fn(),
  storeDeliveryOtp: vi.fn(),
  sendDeliveryOtpNotification: vi.fn(),
};

describe('deliveryVerificationService', () => {
  let deliveryVerificationService;

  beforeEach(async () => {
    vi.clearAllMocks();
    deliveryVerificationService = new (await import('../../src/services/order/deliveryVerificationService.js')).DeliveryVerificationService(
      mockOrderRepository,
      { notificationService: mockNotificationService },
    );
  });

  describe('validateDeliveryOtp', () => {
    it('validates the delivery OTP when the order has arrived', async () => {
      mockOrderRepository.findOrderById.mockResolvedValue({
        data: { id: 'order-1', driver_id: 'driver-1', status: 'arriving', escrow_status: 'funded' },
        error: null,
      });
      mockNotificationService.getActiveDeliveryOtp.mockResolvedValue({ id: 'otp-1', order_id: 'order-1' });
      mockNotificationService.verifyDeliveryOtpHash.mockReturnValue(true);

      const result = await deliveryVerificationService.validateDeliveryOtp({
        orderId: 'order-1',
        driverId: 'driver-1',
        otp: '123456',
      });

      expect(result.order.id).toBe('order-1');
      expect(result.otpRecord).toEqual({ id: 'otp-1', order_id: 'order-1' });
      expect(mockNotificationService.getActiveDeliveryOtp).toHaveBeenCalledWith('order-1');
      expect(mockNotificationService.verifyDeliveryOtpHash).toHaveBeenCalledWith('123456', { id: 'otp-1', order_id: 'order-1' });
    });

    it('throws when the order is not found', async () => {
      mockOrderRepository.findOrderById.mockResolvedValue({ data: null, error: null });

      await expect(
        deliveryVerificationService.validateDeliveryOtp({ orderId: 'order-nonexistent', driverId: 'driver-1', otp: '123456' }),
      ).rejects.toThrow('Order not found.');
    });

    it('throws when the driver is not assigned to the order', async () => {
      mockOrderRepository.findOrderById.mockResolvedValue({
        data: { id: 'order-1', driver_id: 'driver-2' },
        error: null,
      });

      await expect(
        deliveryVerificationService.validateDeliveryOtp({ orderId: 'order-1', driverId: 'driver-1', otp: '123456' }),
      ).rejects.toThrow('Access Denied: You are not assigned to this order.');
    });

    it('throws when the order has not reached the delivery location', async () => {
      mockOrderRepository.findOrderById.mockResolvedValue({
        data: { id: 'order-1', driver_id: 'driver-1', status: 'in_transit' },
        error: null,
      });

      await expect(
        deliveryVerificationService.validateDeliveryOtp({ orderId: 'order-1', driverId: 'driver-1', otp: '123456' }),
      ).rejects.toThrow('Delivery OTP can only be verified after the shipment reaches the delivery location.');
    });

    it('throws when no active OTP is available', async () => {
      mockOrderRepository.findOrderById.mockResolvedValue({
        data: { id: 'order-1', driver_id: 'driver-1', status: 'arriving' },
        error: null,
      });
      mockNotificationService.getActiveDeliveryOtp.mockResolvedValue(null);

      await expect(
        deliveryVerificationService.validateDeliveryOtp({ orderId: 'order-1', driverId: 'driver-1', otp: '123456' }),
      ).rejects.toThrow('OTP not available or has expired.');
    });

    it('throws on an invalid OTP', async () => {
      mockOrderRepository.findOrderById.mockResolvedValue({
        data: { id: 'order-1', driver_id: 'driver-1', status: 'arriving' },
        error: null,
      });
      mockNotificationService.getActiveDeliveryOtp.mockResolvedValue({ id: 'otp-1', order_id: 'order-1' });
      mockNotificationService.verifyDeliveryOtpHash.mockReturnValue(false);

      await expect(
        deliveryVerificationService.validateDeliveryOtp({ orderId: 'order-1', driverId: 'driver-1', otp: '000000' }),
      ).rejects.toThrow('Invalid OTP. 4 attempt(s) remaining before lockout.');
    });
  });
});
