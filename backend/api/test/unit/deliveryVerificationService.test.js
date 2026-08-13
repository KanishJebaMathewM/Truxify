import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockOrderRepository = {
  findOrderById: vi.fn(),
  updateOrderWithFilter: vi.fn(),
};

vi.mock('../../src/core/container.js', () => ({
  orderRepository: mockOrderRepository,
}));

describe('deliveryVerificationService', () => {
  let deliveryVerificationService;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    deliveryVerificationService = (await import('../../src/services/order/deliveryVerificationService.js')).default;
  });

  describe('verifyDelivery', () => {
    it('verifies delivery when order is in_transit', async () => {
      const order = { id: 'order-1', status: 'in_transit', escrow_status: 'funded' };
      mockOrderRepository.findOrderById.mockResolvedValue(order);
      mockOrderRepository.updateOrderWithFilter.mockResolvedValue({ error: null });

      const result = await deliveryVerificationService.verifyDelivery('order-1', { proof: 'photo_url' });
      expect(mockOrderRepository.updateOrderWithFilter).toHaveBeenCalled();
    });

    it('throws when order is not in_transit', async () => {
      const order = { id: 'order-1', status: 'pending' };
      mockOrderRepository.findOrderById.mockResolvedValue(order);

      await expect(
        deliveryVerificationService.verifyDelivery('order-1', { proof: 'photo_url' }),
      ).rejects.toThrow();
    });

    it('throws when order not found', async () => {
      mockOrderRepository.findOrderById.mockResolvedValue(null);
      await expect(
        deliveryVerificationService.verifyDelivery('order-nonexistent', { proof: 'photo_url' }),
      ).rejects.toThrow();
    });
  });

  describe('rejectDelivery', () => {
    it('rejects delivery with reason', async () => {
      const order = { id: 'order-1', status: 'in_transit' };
      mockOrderRepository.findOrderById.mockResolvedValue(order);
      mockOrderRepository.updateOrderWithFilter.mockResolvedValue({ error: null });

      const result = await deliveryVerificationService.rejectDelivery('order-1', { reason: 'Proof unclear' });
      expect(mockOrderRepository.updateOrderWithFilter).toHaveBeenCalled();
    });
  });
});
