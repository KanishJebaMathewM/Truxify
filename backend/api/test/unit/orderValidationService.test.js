import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockOrderRepository = {
  findOrderById: vi.fn(),
  findOrderByDisplayId: vi.fn(),
};

vi.mock('../../src/core/container.js', () => ({
  orderRepository: mockOrderRepository,
}));

describe('orderValidationService', () => {
  let orderValidationService;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    orderValidationService = (await import('../../src/services/order/orderValidationService.js')).default;
  });

  describe('findOrderByIdOrDisplayId', () => {
    it('finds order by UUID id', async () => {
      const order = { id: 'order-uuid-1', order_display_id: '#FF20260808ABC', status: 'pending' };
      mockOrderRepository.findOrderById.mockResolvedValue(order);

      const result = await orderValidationService.findOrderByIdOrDisplayId('order-uuid-1');
      expect(result).toEqual(order);
    });

    it('finds order by display id', async () => {
      const order = { id: 'order-uuid-1', order_display_id: '#FF20260808ABC', status: 'pending' };
      mockOrderRepository.findOrderById.mockResolvedValue(null);
      mockOrderRepository.findOrderByDisplayId.mockResolvedValue(order);

      const result = await orderValidationService.findOrderByIdOrDisplayId('#FF20260808ABC');
      expect(result).toEqual(order);
    });

    it('returns null when order not found by either id', async () => {
      mockOrderRepository.findOrderById.mockResolvedValue(null);
      mockOrderRepository.findOrderByDisplayId.mockResolvedValue(null);

      const result = await orderValidationService.findOrderByIdOrDisplayId('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('validateOrderForBidAcceptance', () => {
    it('returns true for order in accepting state', () => {
      const order = { id: 'order-1', status: 'pending', escrow_status: 'pending' };
      const result = orderValidationService.validateOrderForBidAcceptance(order);
      expect(result).toBe(true);
    });

    it('returns false for order in terminal state', () => {
      const order = { id: 'order-1', status: 'delivered' };
      const result = orderValidationService.validateOrderForBidAcceptance(order);
      expect(result).toBe(false);
    });
  });
});
