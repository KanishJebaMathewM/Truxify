import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockOrderRepository = {
  createTimeline: vi.fn(),
  getTimeline: vi.fn(),
  updateTimelineMilestone: vi.fn(),
  deleteTimeline: vi.fn(),
};

describe('orderTimelineService', () => {
  let orderTimelineService;

  beforeEach(async () => {
    vi.clearAllMocks();
    orderTimelineService = new (await import('../../src/services/order/orderTimelineService.js')).OrderTimelineService(mockOrderRepository);
  });

  describe('createOrderTimeline', () => {
    it('creates the default milestone timeline for an order', async () => {
      mockOrderRepository.createTimeline.mockResolvedValue({ data: [], error: null });

      await orderTimelineService.createOrderTimeline('order-1');
      expect(mockOrderRepository.createTimeline).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ order_display_id: 'order-1', milestone: 'Order Placed', completed: true }),
          expect.objectContaining({ order_display_id: 'order-1', milestone: 'In Transit', completed: false }),
          expect.objectContaining({ order_display_id: 'order-1', milestone: 'Delivered', completed: false }),
        ]),
      );
    });

    it('throws when the timeline insert fails', async () => {
      mockOrderRepository.createTimeline.mockResolvedValue({ data: null, error: { message: 'DB insert failed' } });

      await expect(orderTimelineService.createOrderTimeline('order-1')).rejects.toThrow('Failed to create order timeline.');
    });
  });

  describe('getOrderTimeline', () => {
    it('returns the stored timeline events', async () => {
      const events = [
        { id: 'e1', created_at: '2026-08-01T10:00:00Z', type: 'created' },
        { id: 'e2', created_at: '2026-08-01T11:00:00Z', type: 'status_change' },
      ];
      mockOrderRepository.getTimeline.mockResolvedValue({ data: events, error: null });

      const result = await orderTimelineService.getOrderTimeline('order-1');
      expect(result).toEqual(events);
    });

    it('returns an empty array when no events exist', async () => {
      mockOrderRepository.getTimeline.mockResolvedValue({ data: [], error: null });

      const result = await orderTimelineService.getOrderTimeline('order-1');
      expect(result).toEqual([]);
    });
  });

  describe('completeMilestone', () => {
    it('marks a milestone as completed', async () => {
      mockOrderRepository.updateTimelineMilestone.mockResolvedValue({ error: null });

      await orderTimelineService.completeMilestone('order-1', 'In Transit', '2026-08-01T11:00:00Z');
      expect(mockOrderRepository.updateTimelineMilestone).toHaveBeenCalledWith(
        'order-1',
        'In Transit',
        expect.objectContaining({ completed: true, milestone_time: '2026-08-01T11:00:00Z' }),
      );
    });
  });
});
