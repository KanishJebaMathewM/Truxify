import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockOrderRepository = {
  findOrderById: vi.fn(),
  updateOrderWithFilter: vi.fn(),
};

vi.mock('../../src/core/container.js', () => ({
  orderRepository: mockOrderRepository,
}));

describe('orderLifecycleService', () => {
  let orderLifecycleService;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    orderLifecycleService = (await import('../../src/services/order/orderLifecycleService.js')).default;
  });

  describe('startOrder', () => {
    it('starts an order in pending state', async () => {
      const order = { id: 'order-1', status: 'pending', escrow_status: 'pending' };
      mockOrderRepository.findOrderById.mockResolvedValue(order);
      mockOrderRepository.updateOrderWithFilter.mockResolvedValue({ error: null });

      const result = await orderLifecycleService.startOrder('order-1', 'driver-1');
      expect(mockOrderRepository.updateOrderWithFilter).toHaveBeenCalled();
    });

    it('throws when order not found', async () => {
      mockOrderRepository.findOrderById.mockResolvedValue(null);
      await expect(orderLifecycleService.startOrder('order-nonexistent', 'driver-1')).rejects.toThrow();
    });
  });

  describe('completeOrder', () => {
    it('completes an order in_transit', async () => {
      const order = { id: 'order-1', status: 'in_transit', escrow_status: 'funded' };
      mockOrderRepository.findOrderById.mockResolvedValue(order);
      mockOrderRepository.updateOrderWithFilter.mockResolvedValue({ error: null });

      await expect(orderLifecycleService.completeOrder('order-1')).resolves.not.toThrow();
    });

    it('throws when trying to complete delivered order', async () => {
      const order = { id: 'order-1', status: 'delivered' };
      mockOrderRepository.findOrderById.mockResolvedValue(order);
      await expect(orderLifecycleService.completeOrder('order-1')).rejects.toThrow();
    });
  });
});
