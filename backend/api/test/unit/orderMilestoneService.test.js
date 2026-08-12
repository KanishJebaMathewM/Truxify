import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/notificationService.js', () => ({
  sendDeliveryOtpNotification: vi.fn(),
  storeDeliveryOtp: vi.fn(),
  getActiveDeliveryOtp: vi.fn(),
  verifyDeliveryOtp: vi.fn(),
  verifyDeliveryOtpHash: vi.fn(),
}));

vi.mock('../../src/services/escrow.js', () => ({
  escrowRelease: vi.fn(),
  markEscrowBookingStarted: vi.fn(),
  paisaToMaticWei: vi.fn(),
}));

vi.mock('../../src/sockets/tracker.js', () => ({
  broadcastOrderMilestone: vi.fn(),
}));

import { markEscrowBookingStarted } from '../../src/services/escrow.js';
import { broadcastOrderMilestone } from '../../src/sockets/tracker.js';

const mockOrderRepository = {
  findOrderById: vi.fn(),
  updateOrder: vi.fn(),
};

const mockOrderTimelineService = {
  getOrderTimeline: vi.fn(),
  completeMilestone: vi.fn(),
  resetMilestone: vi.fn(),
};

const baseTimeline = (overrides = []) => [
  { milestone: 'Order Placed', completed: true, sort_order: 10 },
  { milestone: 'Truck Assigned', completed: true, sort_order: 20 },
  { milestone: 'En Route to Pickup', completed: true, sort_order: 30 },
  { milestone: 'Arrived at Pickup', completed: true, sort_order: 35 },
  { milestone: 'Goods Loaded', completed: false, sort_order: 40 },
  { milestone: 'In Transit', completed: false, sort_order: 50 },
  { milestone: 'Arriving', completed: false, sort_order: 55 },
  { milestone: 'Delivered', completed: false, sort_order: 60 },
  ...overrides,
];

describe('orderMilestoneService', () => {
  let orderMilestoneService;

  beforeEach(async () => {
    vi.clearAllMocks();
    orderMilestoneService = new (await import('../../src/services/order/orderMilestoneService.js')).OrderMilestoneService({
      orderRepository: mockOrderRepository,
      orderTimelineService: mockOrderTimelineService,
    });
  });

  describe('updateMilestone', () => {
    it('transitions the order to the requested milestone', async () => {
      const order = { id: 'order-1', order_display_id: 'OD-1', driver_id: 'driver-1', customer_id: 'customer-1', escrow_status: 'funded' };
      const updatedOrder = { ...order, status: 'picked_up' };
      mockOrderRepository.findOrderById.mockResolvedValue({ data: order, error: null });
      mockOrderTimelineService.getOrderTimeline.mockResolvedValue(baseTimeline());
      mockOrderTimelineService.completeMilestone.mockResolvedValue({ error: null });
      mockOrderRepository.updateOrder.mockResolvedValue({ data: updatedOrder, error: null });
      markEscrowBookingStarted.mockResolvedValue({ error: 'chain unavailable' });

      const result = await orderMilestoneService.updateMilestone({ orderId: 'order-1', milestone: 'Goods Loaded', driverId: 'driver-1' });

      expect(mockOrderRepository.updateOrder).toHaveBeenCalledWith('order-1', expect.objectContaining({ status: 'picked_up' }));
      expect(mockOrderTimelineService.completeMilestone).toHaveBeenCalledWith('OD-1', 'Goods Loaded');
      expect(broadcastOrderMilestone).toHaveBeenCalledWith('OD-1', 'Goods Loaded', 'picked_up');
      expect(result).toEqual({ order: updatedOrder, milestone: 'Goods Loaded', status: 'picked_up' });
    });

    it('throws when the order is not found', async () => {
      mockOrderRepository.findOrderById.mockResolvedValue({ data: null, error: null });

      await expect(
        orderMilestoneService.updateMilestone({ orderId: 'order-nonexistent', milestone: 'Goods Loaded', driverId: 'driver-1' }),
      ).rejects.toThrow('Order not found.');
    });

    it('throws when the driver is not assigned to the order', async () => {
      mockOrderRepository.findOrderById.mockResolvedValue({
        data: { id: 'order-1', driver_id: 'driver-2' },
        error: null,
      });

      await expect(
        orderMilestoneService.updateMilestone({ orderId: 'order-1', milestone: 'Goods Loaded', driverId: 'driver-1' }),
      ).rejects.toThrow('Access Denied: You are not assigned to this order.');
    });

    it('throws when Delivered is set directly', async () => {
      await expect(
        orderMilestoneService.updateMilestone({ orderId: 'order-1', milestone: 'Delivered', driverId: 'driver-1' }),
      ).rejects.toThrow('Cannot set Delivered milestone directly');
    });

    it('throws when the milestone has already been completed', async () => {
      mockOrderRepository.findOrderById.mockResolvedValue({
        data: { id: 'order-1', order_display_id: 'OD-1', driver_id: 'driver-1' },
        error: null,
      });
      mockOrderTimelineService.getOrderTimeline.mockResolvedValue([
        { milestone: 'Order Placed', completed: true, sort_order: 10 },
        { milestone: 'Goods Loaded', completed: true, sort_order: 40 },
        { milestone: 'In Transit', completed: false, sort_order: 50 },
      ]);

      await expect(
        orderMilestoneService.updateMilestone({ orderId: 'order-1', milestone: 'Goods Loaded', driverId: 'driver-1' }),
      ).rejects.toThrow('has already been completed.');
    });

    it('throws when the milestone is out of sequence', async () => {
      mockOrderRepository.findOrderById.mockResolvedValue({
        data: { id: 'order-1', order_display_id: 'OD-1', driver_id: 'driver-1' },
        error: null,
      });
      mockOrderTimelineService.getOrderTimeline.mockResolvedValue([
        { milestone: 'Order Placed', completed: true, sort_order: 10 },
        { milestone: 'In Transit', completed: true, sort_order: 50 },
        { milestone: 'Goods Loaded', completed: false, sort_order: 40 },
      ]);

      await expect(
        orderMilestoneService.updateMilestone({ orderId: 'order-1', milestone: 'Goods Loaded', driverId: 'driver-1' }),
      ).rejects.toThrow('Milestone out of sequence.');
    });
  });
});
