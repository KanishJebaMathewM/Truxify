import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockOrderRepository = {
  getTimeline: vi.fn(),
  updateTimelineMilestone: vi.fn(),
  createTimeline: vi.fn(),
};

describe('orderTimelineService', () => {
  let orderTimelineService;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const { OrderTimelineService } = await import('../../src/services/order/orderTimelineService.js');
    orderTimelineService = new OrderTimelineService(mockOrderRepository);
  });

  describe('getOrderTimeline', () => {
    it('returns events for an order', async () => {
      mockOrderRepository.getTimeline.mockResolvedValue({
        data: [{ id: 'e1', milestone: 'Order Placed' }],
        error: null,
      });

      const result = await orderTimelineService.getOrderTimeline('order-1');
      expect(result).toHaveLength(1);
      expect(mockOrderRepository.getTimeline).toHaveBeenCalledWith('order-1');
    });

    it('returns empty array when no events', async () => {
      mockOrderRepository.getTimeline.mockResolvedValue({ data: [], error: null });
      const result = await orderTimelineService.getOrderTimeline('order-1');
      expect(result).toEqual([]);
    });

    it('throws when the timeline query fails', async () => {
      mockOrderRepository.getTimeline.mockResolvedValue({ data: null, error: { message: 'DB down' } });
      await expect(orderTimelineService.getOrderTimeline('order-1')).rejects.toThrow();
    });
  });

  describe('completeMilestone', () => {
    it('marks a milestone completed', async () => {
      mockOrderRepository.updateTimelineMilestone.mockResolvedValue({ error: null });

      await expect(orderTimelineService.completeMilestone('order-1', 'In Transit')).resolves.not.toThrow();
      expect(mockOrderRepository.updateTimelineMilestone).toHaveBeenCalledWith(
        'order-1', 'In Transit', expect.objectContaining({ completed: true }),
      );
    });

    it('throws when the milestone update fails', async () => {
      mockOrderRepository.updateTimelineMilestone.mockResolvedValue({ error: { message: 'DB down' } });
      await expect(orderTimelineService.completeMilestone('order-1', 'In Transit')).rejects.toThrow();
    });
  });
});
