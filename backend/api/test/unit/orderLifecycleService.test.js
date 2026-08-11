import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/notificationService.js', () => ({
  sendPushNotification: vi.fn(),
  expireDeliveryOtps: vi.fn(),
  sendDeliveryOtpNotification: vi.fn(),
  storeDeliveryOtp: vi.fn(),
  getActiveDeliveryOtp: vi.fn(),
  verifyDeliveryOtp: vi.fn(),
  verifyDeliveryOtpHash: vi.fn(),
}));

import { sendPushNotification } from '../../src/services/notificationService.js';

const mockOrderRepository = {
  findOrderById: vi.fn(),
  updateOrder: vi.fn(),
};

const mockOrderTimelineService = {
  getTimeline: vi.fn(),
  getTimelineWithSortCheck: vi.fn(),
  markMilestoneCompleted: vi.fn(),
  rollbackMilestone: vi.fn(),
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

describe('orderLifecycleService', () => {
  let orderLifecycleService;

  beforeEach(async () => {
    vi.clearAllMocks();
    orderLifecycleService = new (await import('../../src/services/order/orderLifecycleService.js')).OrderLifecycleService({
      orderRepository: mockOrderRepository,
      orderTimelineService: mockOrderTimelineService,
    });
  });

  describe('updateMilestone', () => {
    it('transitions an order to a milestone in sequence', async () => {
      const order = { id: 'order-1', order_display_id: 'OD-1', driver_id: 'driver-1', customer_id: 'customer-1' };
      const updatedOrder = { ...order, status: 'picked_up' };
      mockOrderRepository.findOrderById.mockResolvedValue({ data: order, error: null });
      mockOrderTimelineService.getTimelineWithSortCheck.mockResolvedValue({ data: baseTimeline(), error: null });
      mockOrderTimelineService.markMilestoneCompleted.mockResolvedValue({ error: null });
      mockOrderRepository.updateOrder.mockResolvedValue({ data: updatedOrder, error: null });
      sendPushNotification.mockResolvedValue({});

      const result = await orderLifecycleService.updateMilestone('order-1', 'Goods Loaded', 'driver-1');

      expect(mockOrderRepository.updateOrder).toHaveBeenCalledWith('order-1', expect.objectContaining({ status: 'picked_up' }));
      expect(mockOrderTimelineService.markMilestoneCompleted).toHaveBeenCalledWith('OD-1', 'Goods Loaded');
      expect(sendPushNotification).toHaveBeenCalledWith(
        'customer-1',
        'Order Update',
        expect.stringContaining('OD-1'),
        'order_update',
        expect.objectContaining({ milestone: 'Goods Loaded' }),
      );
      expect(result).toEqual({ order: updatedOrder, milestone: 'Goods Loaded', status: 'picked_up' });
    });

    it('throws when the order is not found', async () => {
      mockOrderRepository.findOrderById.mockResolvedValue({ data: null, error: null });

      await expect(orderLifecycleService.updateMilestone('order-nonexistent', 'Goods Loaded', 'driver-1'))
        .rejects.toThrow('Order not found.');
    });

    it('throws when the driver is not assigned to the order', async () => {
      mockOrderRepository.findOrderById.mockResolvedValue({
        data: { id: 'order-1', driver_id: 'driver-2' },
        error: null,
      });

      await expect(orderLifecycleService.updateMilestone('order-1', 'Goods Loaded', 'driver-1'))
        .rejects.toThrow('Access Denied: You are not assigned to this order.');
    });

    it('throws when the milestone does not map to an order status', async () => {
      const timeline = [
        { milestone: 'Order Placed', completed: true, sort_order: 10 },
        { milestone: 'Truck Assigned', completed: true, sort_order: 20 },
        { milestone: 'En Route to Pickup', completed: true, sort_order: 30 },
        { milestone: 'Arrived at Pickup', completed: true, sort_order: 35 },
        { milestone: 'Goods Loaded', completed: true, sort_order: 40 },
        { milestone: 'In Transit', completed: true, sort_order: 50 },
        { milestone: 'Arriving', completed: true, sort_order: 55 },
        { milestone: 'Delivered', completed: false, sort_order: 60 },
      ];
      mockOrderRepository.findOrderById.mockResolvedValue({
        data: { id: 'order-1', order_display_id: 'OD-1', driver_id: 'driver-1', customer_id: 'customer-1' },
        error: null,
      });
      mockOrderTimelineService.getTimelineWithSortCheck.mockResolvedValue({ data: timeline, error: null });

      await expect(orderLifecycleService.updateMilestone('order-1', 'Delivered', 'driver-1'))
        .rejects.toThrow('does not map to an order status');
    });
  });
});
