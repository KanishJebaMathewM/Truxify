import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockOrderRepository = {
  findOrderById: vi.fn(),
  addMilestone: vi.fn(),
  completeMilestone: vi.fn(),
};

vi.mock('../../src/core/container.js', () => ({
  orderRepository: mockOrderRepository,
}));

describe('orderMilestoneService', () => {
  let orderMilestoneService;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    orderMilestoneService = (await import('../../src/services/order/orderMilestoneService.js')).default;
  });

  describe('addMilestone', () => {
    it('adds a milestone to an order', async () => {
      const milestone = { id: 'm1', order_id: 'order-1', type: 'pickup', status: 'pending' };
      mockOrderRepository.findOrderById.mockResolvedValue({ id: 'order-1', status: 'pending' });
      mockOrderRepository.addMilestone.mockResolvedValue(milestone);

      const result = await orderMilestoneService.addMilestone('order-1', { type: 'pickup', description: 'Picked up cargo' });
      expect(mockOrderRepository.addMilestone).toHaveBeenCalled();
    });

    it('throws when order not found', async () => {
      mockOrderRepository.findOrderById.mockResolvedValue(null);
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
});
