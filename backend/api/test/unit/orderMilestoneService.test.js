import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrderMilestoneService } from '../../src/services/order/orderMilestoneService.js';
import { paisaToMaticWei } from '../../src/services/escrow.js';

vi.mock('../../src/services/escrow.js', async (importActual) => {
  const actual = await importActual();
  return { ...actual, escrowRelease: vi.fn() };
});

// vi.mock factories are hoisted above these consts — declare via vi.hoisted
// so the lazy factories see initialized values.
const { mockOrderRepository, mockLogger, mockTrackingTokenService } = vi.hoisted(() => ({
  mockOrderRepository: {
    findOrderById: vi.fn(),
    addMilestone: vi.fn(),
    completeMilestone: vi.fn(),
    updateOrderGuardStatus: vi.fn(),
    executeRpc: vi.fn(),
    updateOrder: vi.fn(),
    updateWalletTransaction: vi.fn().mockResolvedValue({ error: null }),
  },
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  mockTrackingTokenService: { revokeAllForOrder: vi.fn() },
}));

vi.mock('../../src/middleware/logger.js', () => ({ default: mockLogger }));
vi.mock('../../src/services/order/orderNotificationService.js', () => ({
  checkOtpLockout: vi.fn().mockResolvedValue(false),
  clearOtpState: vi.fn().mockResolvedValue(undefined),
  DELIVERY_OTP_READY_STATUSES: new Set(['arriving']),
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