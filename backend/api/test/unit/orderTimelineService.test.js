import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFrom = vi.fn();
const mockOrderRepository = {
  addTimelineEvent: vi.fn(),
  getOrderTimeline: vi.fn(),
};

vi.mock('../../src/config/db.js', () => ({
  supabase: { from: mockFrom },
}));

vi.mock('../../src/core/container.js', () => ({
  orderRepository: mockOrderRepository,
}));

describe('orderTimelineService', () => {
  let orderTimelineService;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    orderTimelineService = (await import('../../src/services/order/orderTimelineService.js')).default;
  });

  describe('addTimelineEvent', () => {
    it('adds a timeline event with actor info', async () => {
      const event = { id: 'e1', order_id: 'order-1', type: 'status_change', created_at: new Date().toISOString() };
      mockOrderRepository.addTimelineEvent.mockResolvedValue(event);

      const result = await orderTimelineService.addTimelineEvent('order-1', {
        type: 'status_change',
        actor: 'driver-1',
        description: 'Order started',
      });
      expect(mockOrderRepository.addTimelineEvent).toHaveBeenCalled();
    });

    it('throws when database insert fails', async () => {
      mockOrderRepository.addTimelineEvent.mockRejectedValue(new Error('DB insert failed'));
      await expect(
        orderTimelineService.addTimelineEvent('order-1', { type: 'status_change' }),
      ).rejects.toThrow('DB insert failed');
    });
  });

  describe('getOrderTimeline', () => {
    it('returns events in chronological order', async () => {
      const events = [
        { id: 'e1', created_at: '2026-08-01T10:00:00Z', type: 'created' },
        { id: 'e2', created_at: '2026-08-01T11:00:00Z', type: 'status_change' },
      ];
      mockOrderRepository.getOrderTimeline.mockResolvedValue(events);

      const result = await orderTimelineService.getOrderTimeline('order-1');
      expect(result).toHaveLength(2);
      expect(result[0].created_at).toBeLessThan(result[1].created_at);
    });

    it('returns empty array when no events', async () => {
      mockOrderRepository.getOrderTimeline.mockResolvedValue([]);
      const result = await orderTimelineService.getOrderTimeline('order-1');
      expect(result).toEqual([]);
    });
  });
});
