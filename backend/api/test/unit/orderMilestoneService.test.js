import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrderMilestoneService } from '../../src/services/order/orderMilestoneService.js';

const mockOrderRepository = {
  findOrderById: vi.fn(),
  addMilestone: vi.fn(),
  completeMilestone: vi.fn(),
};
const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock('../../src/middleware/logger.js', () => ({ default: mockLogger }));

describe('orderMilestoneService', () => {
  let orderMilestoneService;

  beforeEach(() => {
    vi.clearAllMocks();
    orderMilestoneService = new OrderMilestoneService({ orderRepository: mockOrderRepository, logger: mockLogger });
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
});