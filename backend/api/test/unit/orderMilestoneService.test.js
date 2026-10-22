import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrderMilestoneService } from '../../src/services/order/orderMilestoneService.js';
import { paisaToMaticWei } from '../../src/services/escrow.js';

vi.mock('../../src/services/escrow.js', async (importActual) => {
  const actual = await importActual();
  return { ...actual, escrowRelease: vi.fn() };
});

const mockOrderRepository = {
  findOrderById: vi.fn(),
  addMilestone: vi.fn(),
  completeMilestone: vi.fn(),
  updateOrderGuardStatus: vi.fn(),
  executeRpc: vi.fn(),
  updateOrder: vi.fn(),
  updateWalletTransaction: vi.fn().mockResolvedValue({ error: null }),
};
const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
const mockTrackingTokenService = { revokeAllForOrder: vi.fn() };

vi.mock('../../src/middleware/logger.js', () => ({ default: mockLogger }));
vi.mock('../../src/services/order/orderNotificationService.js', () => ({
  checkOtpLockout: vi.fn().mockResolvedValue(false),
  DELIVERY_OTP_READY_STATUSES: new Set(['arriving']),
  clearOtpState: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../src/services/notificationService.js', () => ({
  getActiveDeliveryOtp: vi.fn().mockResolvedValue({ id: 'otp-1' }),
  verifyDeliveryOtpHash: vi.fn().mockReturnValue(true),
  verifyDeliveryOtp: vi.fn().mockResolvedValue({}),
  clearOtpState: vi.fn().mockResolvedValue({}),
}));

describe('orderMilestoneService', () => {
  let orderMilestoneService;

  beforeEach(() => {
    vi.clearAllMocks();
    orderMilestoneService = new OrderMilestoneService({
      orderRepository: mockOrderRepository,
      logger: mockLogger,
      trackingTokenService: mockTrackingTokenService,
    });
  });

  describe('constructor', () => {
    it('correctly receives and stores all supported injected dependencies', () => {
      const orderRepository = {};
      const orderValidationService = {};
      const orderTimelineService = {};
      const orderNotificationService = {};
      const trackingTokenService = {};

      const service = new OrderMilestoneService({
        orderRepository,
        orderValidationService,
        orderTimelineService,
        orderNotificationService,
        trackingTokenService,
      });

      expect(service.orderRepository).toBe(orderRepository);
      expect(service.validation).toBe(orderValidationService);
      expect(service.orderTimelineService).toBe(orderTimelineService);
      expect(service.orderNotificationService).toBe(orderNotificationService);
      expect(service.trackingTokenService).toBe(trackingTokenService);
    });
  });

  describe('addMilestone', () => {
    it('adds a milestone to an order', async () => {
      const milestone = { id: 'm1', order_id: 'order-1', type: 'pickup', status: 'pending' };
      mockOrderRepository.findOrderById.mockResolvedValue({ data: { id: 'order-1', status: 'pending' }, error: null });
      mockOrderRepository.addMilestone.mockResolvedValue({ data: milestone, error: null });

      await orderMilestoneService.addMilestone('order-1', { type: 'pickup', description: 'Picked up cargo' });
      expect(mockOrderRepository.addMilestone).toHaveBeenCalled();
    });

    it('throws when order not found', async () => {
      mockOrderRepository.findOrderById.mockResolvedValue({ data: null, error: null });
      await expect(
        orderMilestoneService.addMilestone('order-nonexistent', { type: 'pickup' }),
      ).rejects.toThrow();
    });
  });

  describe('completeMilestone', () => {
    it('completes a pending milestone', async () => {
      mockOrderRepository.completeMilestone.mockResolvedValue({ error: null });
      await expect(orderMilestoneService.completeMilestone('m1')).resolves.not.toThrow();
    });

    it('throws when milestone not found', async () => {
      mockOrderRepository.completeMilestone.mockResolvedValue({ error: { message: 'Not found' } });
      await expect(orderMilestoneService.completeMilestone('m-nonexistent')).rejects.toThrow();
    });
  });

  describe('verifyDelivery', () => {
    it('releases escrow against the escrowed bid, not total_amount', async () => {
      const bidAmountPaisa = 100000;
      const totalAmountPaisa = 150000;
      const escrowAmountWei = paisaToMaticWei(bidAmountPaisa);

      mockOrderRepository.findOrderById
        .mockResolvedValueOnce({
          data: {
            id: 'order-1',
            order_display_id: 'ORD-1',
            driver_id: 'driver-1',
            customer_id: 'customer-1',
            escrow_status: 'funded',
            escrow_release_attempts: 0,
            status: 'arriving',
            total_amount: totalAmountPaisa,
            escrow_amount_wei: String(escrowAmountWei),
            pending_bid_acceptance: { bid_amount: bidAmountPaisa },
          },
          error: null,
        })
        .mockResolvedValueOnce({
          data: { status: 'payment_released', escrow_status: 'released', escrow_release_attempts: 1 },
          error: null,
        });

      const { escrowRelease } = await import('../../src/services/escrow.js');
      escrowRelease.mockResolvedValue({ txHash: '0xtx' });

      mockOrderRepository.updateOrderGuardStatus.mockResolvedValue({ error: null });
      mockOrderRepository.executeRpc.mockResolvedValue({ data: {}, error: null });
      mockOrderRepository.updateOrder.mockResolvedValue({ error: null });

      await orderMilestoneService.verifyDelivery(
        { orderId: 'order-1', otp: '123456', driverId: 'driver-1' },
        {},
      );

      expect(escrowRelease).toHaveBeenCalledTimes(1);
      const [, releasedWei] = escrowRelease.mock.calls[0];
      expect(releasedWei).toBe(escrowAmountWei);
      expect(releasedWei).not.toBe(paisaToMaticWei(totalAmountPaisa));
    });
  });
});