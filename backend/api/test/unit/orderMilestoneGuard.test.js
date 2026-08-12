import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { notifMock } = vi.hoisted(() => ({
  notifMock: {
    sendDeliveryOtpNotification: vi.fn(),
    storeDeliveryOtp: vi.fn(),
    getActiveDeliveryOtp: vi.fn(),
    verifyDeliveryOtp: vi.fn(),
    verifyDeliveryOtpHash: vi.fn(),
  },
}));

vi.mock('../../src/services/notificationService.js', () => notifMock);

vi.mock('../../src/services/escrow.js', () => ({
  escrowRelease: vi.fn(),
  markEscrowBookingStarted: vi.fn(),
}));

vi.mock('../../src/sockets/tracker.js', () => ({
  broadcastOrderMilestone: vi.fn(),
}));

vi.mock('../../src/core/performanceMetrics.js', () => ({
  measureExecution: (_name, fn) => fn(),
}));

import { OrderMilestoneService } from '../../src/services/order/orderMilestoneService.js';
import { DomainError } from '../../src/services/order/domainError.js';

describe('OrderMilestoneService', () => {
  let service;
  let orderRepository;
  let orderTimelineService;

  beforeEach(() => {
    orderRepository = {
      findOrderById: vi.fn(),
      updateOrder: vi.fn(),
    };
    orderTimelineService = {
      getOrderTimeline: vi.fn(),
      completeMilestone: vi.fn(),
      resetMilestone: vi.fn(),
    };
    service = new OrderMilestoneService({ orderRepository, orderTimelineService });
    notifMock.getActiveDeliveryOtp.mockResolvedValue(null);
    notifMock.sendDeliveryOtpNotification.mockResolvedValue({ success: true });
    notifMock.storeDeliveryOtp.mockResolvedValue(true);
  });

  describe('updateMilestone', () => {
    it('rejects setting Delivered directly', async () => {
      await expect(service.updateMilestone({ orderId: 'o1', milestone: 'Delivered', driverId: 'd1' }))
        .rejects.toBeInstanceOf(DomainError);
    });

    it('throws 404 when the order is not found', async () => {
      orderRepository.findOrderById.mockResolvedValue({ data: null, error: null });
      try {
        await service.updateMilestone({ orderId: 'o1', milestone: 'In Transit', driverId: 'd1' });
        expect.unreachable();
      } catch (e) {
        expect(e.status).toBe(404);
      }
    });

    it('throws 403 when the driver is not assigned', async () => {
      orderRepository.findOrderById.mockResolvedValue({ data: { id: 'o1', order_display_id: 'TX-1', driver_id: 'other' }, error: null });
      try {
        await service.updateMilestone({ orderId: 'o1', milestone: 'In Transit', driverId: 'd1' });
        expect.unreachable();
      } catch (e) {
        expect(e.status).toBe(403);
      }
    });

    it('throws 422 when the milestone is out of sequence', async () => {
      orderRepository.findOrderById.mockResolvedValue({ data: { id: 'o1', order_display_id: 'TX-1', driver_id: 'd1' }, error: null });
      orderTimelineService.getOrderTimeline.mockResolvedValue([
        { milestone: 'Order Placed', completed: true, sort_order: 10 },
        { milestone: 'Truck Assigned', completed: false, sort_order: 20 },
        { milestone: 'In Transit', completed: false, sort_order: 50 },
      ]);
      try {
        await service.updateMilestone({ orderId: 'o1', milestone: 'In Transit', driverId: 'd1' });
        expect.unreachable();
      } catch (e) {
        expect(e.status).toBe(422);
      }
    });

    it('throws 409 when the milestone is already completed', async () => {
      orderRepository.findOrderById.mockResolvedValue({ data: { id: 'o1', order_display_id: 'TX-1', driver_id: 'd1' }, error: null });
      orderTimelineService.getOrderTimeline.mockResolvedValue([
        { milestone: 'Order Placed', completed: true, sort_order: 10 },
        { milestone: 'In Transit', completed: true, sort_order: 50 },
      ]);
      try {
        await service.updateMilestone({ orderId: 'o1', milestone: 'In Transit', driverId: 'd1' });
        expect.unreachable();
      } catch (e) {
        expect(e.status).toBe(409);
      }
    });

    it('updates the order status on a valid milestone', async () => {
      orderRepository.findOrderById.mockResolvedValue({ data: { id: 'o1', order_display_id: 'TX-1', driver_id: 'd1', escrow_status: 'pending' }, error: null });
      orderTimelineService.getOrderTimeline.mockResolvedValue([
        { milestone: 'Order Placed', completed: true, sort_order: 10 },
        { milestone: 'In Transit', completed: false, sort_order: 50 },
      ]);
      orderTimelineService.completeMilestone.mockResolvedValue();
      orderRepository.updateOrder.mockResolvedValue({ data: { id: 'o1', status: 'in_transit' }, error: null });
      const result = await service.updateMilestone({ orderId: 'o1', milestone: 'In Transit', driverId: 'd1' });
      expect(result.status).toBe('in_transit');
      expect(orderTimelineService.completeMilestone).toHaveBeenCalledWith('TX-1', 'In Transit');
    });

    it('rolls back the milestone when the order update fails', async () => {
      orderRepository.findOrderById.mockResolvedValue({ data: { id: 'o1', order_display_id: 'TX-1', driver_id: 'd1', escrow_status: 'pending' }, error: null });
      orderTimelineService.getOrderTimeline.mockResolvedValue([
        { milestone: 'Order Placed', completed: true, sort_order: 10 },
        { milestone: 'In Transit', completed: false, sort_order: 50 },
      ]);
      orderTimelineService.completeMilestone.mockResolvedValue();
      orderRepository.updateOrder.mockResolvedValue({ data: null, error: { message: 'db down' } });
      try {
        await service.updateMilestone({ orderId: 'o1', milestone: 'In Transit', driverId: 'd1' });
        expect.unreachable();
      } catch (e) {
        expect(e.status).toBe(500);
        expect(orderTimelineService.resetMilestone).toHaveBeenCalledWith('TX-1', 'In Transit');
      }
    });
  });
});
