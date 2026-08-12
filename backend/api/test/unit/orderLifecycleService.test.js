import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockOrderRepository = {
  findOrdersByCustomer: vi.fn(),
  findOrdersWithCount: vi.fn(),
  findProfilesByIds: vi.fn(),
};

describe('orderLifecycleService', () => {
  let orderLifecycleService;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const { OrderLifecycleService } = await import('../../src/services/order/orderLifecycleService.js');
    orderLifecycleService = new OrderLifecycleService({
      orderRepository: mockOrderRepository,
      orderTimelineService: {},
      bidAcceptanceService: {},
      deliveryVerificationService: {},
      trackingTokenService: null,
    });
  });

  describe('getActiveOrders', () => {
    it('returns active orders enriched with driver names', async () => {
      mockOrderRepository.findOrdersByCustomer.mockResolvedValue({
        data: [{ id: 'order-1', driver_id: 'driver-1' }],
        error: null,
      });
      mockOrderRepository.findProfilesByIds.mockResolvedValue({
        data: [{ id: 'driver-1', full_name: 'Ravi Kumar' }],
      });

      const result = await orderLifecycleService.getActiveOrders('cust-1');

      expect(result).toHaveLength(1);
      expect(result[0].driver_name).toBe('Ravi Kumar');
      expect(mockOrderRepository.findOrdersByCustomer).toHaveBeenCalledWith(
        'cust-1', '*', expect.any(Array), 'pickup_date', false,
      );
    });

    it('throws when the query fails', async () => {
      mockOrderRepository.findOrdersByCustomer.mockResolvedValue({ data: null, error: { message: 'DB down' } });
      await expect(orderLifecycleService.getActiveOrders('cust-1')).rejects.toThrow();
    });
  });

  describe('getOrderHistory', () => {
    it('returns paginated history', async () => {
      mockOrderRepository.findOrdersWithCount.mockResolvedValue({
        data: [{ id: 'order-1' }],
        error: null,
        count: 1,
      });

      const result = await orderLifecycleService.getOrderHistory('cust-1', 1, 10);

      expect(result.total).toBe(1);
      expect(result.totalPages).toBe(1);
      expect(result.history).toHaveLength(1);
    });

    it('throws when the history query fails', async () => {
      mockOrderRepository.findOrdersWithCount.mockResolvedValue({ data: null, error: { message: 'DB down' }, count: 0 });
      await expect(orderLifecycleService.getOrderHistory('cust-1', 1, 10)).rejects.toThrow();
    });
  });
});
