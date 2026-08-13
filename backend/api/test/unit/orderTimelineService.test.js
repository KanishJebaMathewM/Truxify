import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrderTimelineService } from '../../src/services/order/orderTimelineService.js';

const mockSupabase = { from: vi.fn() };
const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock('../../src/config/db.js', () => ({ supabase: mockSupabase }));
vi.mock('../../src/middleware/logger.js', () => ({ default: mockLogger }));

describe('orderTimelineService', () => {
  let orderTimelineService;

  beforeEach(() => {
    vi.clearAllMocks();
    orderTimelineService = new OrderTimelineService({ supabase: mockSupabase, logger: mockLogger });
  });

  describe('addTimelineEvent', () => {
    it('adds a timeline event with actor info', async () => {
      const selectMock = vi.fn().mockResolvedValue({ data: [{ id: 'e1' }], error: null });
      const insertMock = vi.fn().mockReturnValue({ select: selectMock });
      mockSupabase.from.mockReturnValue({ insert: insertMock });

      await orderTimelineService.addTimelineEvent('order-1', {
        type: 'status_change', actor: 'driver-1', description: 'Order started',
      });
      expect(mockSupabase.from).toHaveBeenCalledWith('order_timeline');
    });

    it('throws when database insert fails', async () => {
      const selectMock = vi.fn().mockResolvedValue({ data: null, error: { message: 'DB insert failed' } });
      const insertMock = vi.fn().mockReturnValue({ select: selectMock });
      mockSupabase.from.mockReturnValue({ insert: insertMock });

      await expect(
        orderTimelineService.addTimelineEvent('order-1', { type: 'status_change' }),
      ).rejects.toThrow();
    });
  });

  describe('getOrderTimeline', () => {
    it('returns events in chronological order', async () => {
      const events = [
        { id: 'e1', created_at: '2026-08-01T10:00:00Z', type: 'created' },
        { id: 'e2', created_at: '2026-08-01T11:00:00Z', type: 'status_change' },
      ];
      const orderMock = vi.fn().mockResolvedValue({ data: events, error: null });
      const eqMock = vi.fn().mockReturnValue({ order: orderMock });
      const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
      mockSupabase.from.mockReturnValue({ select: selectMock });

      const result = await orderTimelineService.getOrderTimeline('order-1');
      expect(result).toHaveLength(2);
    });

    it('returns empty array when no events', async () => {
      const orderMock = vi.fn().mockResolvedValue({ data: [], error: null });
      const eqMock = vi.fn().mockReturnValue({ order: orderMock });
      const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
      mockSupabase.from.mockReturnValue({ select: selectMock });

      const result = await orderTimelineService.getOrderTimeline('order-1');
      expect(result).toEqual([]);
    });
  });
});