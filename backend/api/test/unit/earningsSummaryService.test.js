import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFrom = vi.fn();
vi.mock('../../src/config/db.js', () => ({
  supabase: { from: mockFrom },
}));

describe('earningsSummaryService', () => {
  let earningsSummaryService;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    earningsSummaryService = (await import('../../src/services/driver/earningsSummaryService.js')).default;
  });

  describe('getDriverEarningsSummary', () => {
    it('returns summary with total earnings and trip count', async () => {
      const mockTrips = [
        { id: 't1', base_freight: '10000', status: 'delivered', created_at: '2026-08-01' },
        { id: 't2', base_freight: '15000', status: 'delivered', created_at: '2026-08-02' },
      ];
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: mockTrips, error: null }),
      });

      const result = await earningsSummaryService.getDriverEarningsSummary('driver-1', {
        startDate: '2026-08-01',
        endDate: '2026-08-31',
      });

      expect(result.totalEarnings).toBe(25000);
      expect(result.tripCount).toBe(2);
    });

    it('returns zero earnings when no trips found', async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
      });

      const result = await earningsSummaryService.getDriverEarningsSummary('driver-new', {
        startDate: '2026-08-01',
        endDate: '2026-08-31',
      });

      expect(result.totalEarnings).toBe(0);
      expect(result.tripCount).toBe(0);
    });

    it('throws when database query fails', async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
      });

      await expect(
        earningsSummaryService.getDriverEarningsSummary('driver-error', {
          startDate: '2026-08-01',
          endDate: '2026-08-31',
        }),
      ).rejects.toThrow();
    });
  });
});
