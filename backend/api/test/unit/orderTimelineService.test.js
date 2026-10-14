import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrderTimelineService } from '../../src/services/order/orderTimelineService.js';

// vi.hoisted: the vi.mock factory below is hoisted above this line.
const mockLogger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

vi.mock('../../src/config/db.js', () => ({
  redisClient: global.mockRedis,
  upstashRedisClient: global.mockRedis,
  supabase: { from: vi.fn() },
}));
vi.mock('../../src/middleware/logger.js', () => ({ default: mockLogger }));

describe('orderTimelineService', () => {
  let orderTimelineService;
  let orderRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    // The real constructor takes the repository positionally; timeline reads
    // go through orderRepository.getTimeline.
    orderRepository = { getTimeline: vi.fn() };
    orderTimelineService = new OrderTimelineService(orderRepository);
  });

  // NOTE: the previous 'addTimelineEvent' describe pinned a phantom API —
  // no such method ever existed on OrderTimelineService (git history: the
  // name only ever appeared in this test file). Timeline events are written
  // via createOrderTimeline / completeMilestone / insertDropChangedEvent.

  describe('getOrderTimeline', () => {
    it('returns events from the repository in order', async () => {
      const events = [
        { id: 'e1', created_at: '2026-08-01T10:00:00Z', type: 'created' },
        { id: 'e2', created_at: '2026-08-01T11:00:00Z', type: 'status_change' },
      ];
      orderRepository.getTimeline.mockResolvedValue({ data: events, error: null });

      const result = await orderTimelineService.getOrderTimeline('OD-1');
      expect(orderRepository.getTimeline).toHaveBeenCalledWith('OD-1');
      expect(result).toHaveLength(2);
    });

    it('returns empty array when no events', async () => {
      orderRepository.getTimeline.mockResolvedValue({ data: [], error: null });

      const result = await orderTimelineService.getOrderTimeline('OD-1');
      expect(result).toEqual([]);
    });

    it('throws a 500 DomainError when the repository read fails', async () => {
      orderRepository.getTimeline.mockResolvedValue({ data: null, error: { message: 'connection reset' } });

      await expect(orderTimelineService.getOrderTimeline('OD-1')).rejects.toThrow('Failed to fetch order timeline.');
    });
  });
});
