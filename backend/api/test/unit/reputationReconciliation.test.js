import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFrom = vi.fn();

vi.mock('../../src/config/db.js', () => ({
  supabase: { from: mockFrom },
}));

describe('reputationReconciliation', () => {
  let reconcileDriverReputation;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const module = await import('../../src/services/reputationReconciliation.js');
    reconcileDriverReputation = module.reconcileDriverReputation;
  });

  describe('reconcileDriverReputation', () => {
    it('reconciles driver reputation from completed trips', async () => {
      const mockTrips = [
        { id: 't1', driver_id: 'driver-1', customer_rating: 4.5 },
        { id: 't2', driver_id: 'driver-1', customer_rating: 5.0 },
      ];
      mockFrom
        .mockReturnValueOnce({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          gte: vi.fn().mockResolvedValue({ data: mockTrips, error: null }),
        })
        .mockReturnValueOnce({
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ error: null }),
        });

      await expect(reconcileDriverReputation('driver-1')).resolves.not.toThrow();
    });

    it('handles reconciliation when no trips found', async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockResolvedValue({ data: [], error: null }),
      });

      await expect(reconcileDriverReputation('driver-new')).resolves.not.toThrow();
    });

    it('throws when reputation update fails', async () => {
      const mockTrips = [{ id: 't1', driver_id: 'driver-1', customer_rating: 4.0 }];
      mockFrom
        .mockReturnValueOnce({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          gte: vi.fn().mockResolvedValue({ data: mockTrips, error: null }),
        })
        .mockReturnValueOnce({
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ error: { message: 'Update failed' } }),
        });

      await expect(reconcileDriverReputation('driver-error')).rejects.toThrow();
    });
  });
});
