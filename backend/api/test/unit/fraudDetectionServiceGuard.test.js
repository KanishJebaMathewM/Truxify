import { describe, it, expect, vi, beforeEach } from 'vitest';

const { dbMock } = vi.hoisted(() => ({
  dbMock: { supabaseAdmin: { from: vi.fn() } },
}));

vi.mock('../../src/config/db.js', () => ({
  get supabaseAdmin() { return dbMock.supabaseAdmin; },
  get supabase() { return null; },
  get redisClient() { return null; },
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import FraudDetectionService from '../../src/services/fraud/FraudDetectionService.js';

describe('FraudDetectionService stats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.supabaseAdmin = { from: vi.fn() };
  });

  describe('getFraudStats', () => {
    it('returns zeros when supabaseAdmin is unavailable', async () => {
      dbMock.supabaseAdmin = null;
      const stats = await FraudDetectionService.getFraudStats();
      expect(stats).toEqual({ total: 0, highRisk: 0, mediumRisk: 0, lowRisk: 0, avgScore: 0 });
    });

    it('buckets scores into risk bands', async () => {
      dbMock.supabaseAdmin.from.mockReturnValue({
        select: vi.fn(() => ({ order: vi.fn(() => ({ limit: vi.fn().mockResolvedValue({ data: [
          { risk_score: 0.9 }, { risk_score: 0.5 }, { risk_score: 0.2 },
        ] }) })) })),
      });
      const stats = await FraudDetectionService.getFraudStats();
      expect(stats.total).toBe(3);
      expect(stats.highRisk).toBe(1);
      expect(stats.mediumRisk).toBe(1);
      expect(stats.lowRisk).toBe(1);
      expect(stats.avgScore).toBeCloseTo(0.533, 1);
    });

    it('caps the query at 1000 rows', async () => {
      const limit = vi.fn().mockResolvedValue({ data: [], });
      dbMock.supabaseAdmin.from.mockReturnValue({
        select: vi.fn(() => ({ order: vi.fn(() => ({ limit })) })),
      });
      await FraudDetectionService.getFraudStats();
      expect(limit).toHaveBeenCalledWith(1000);
    });

    it('handles a null scores payload', async () => {
      dbMock.supabaseAdmin.from.mockReturnValue({
        select: vi.fn(() => ({ order: vi.fn(() => ({ limit: vi.fn().mockResolvedValue({ data: null }) })) })),
      });
      const stats = await FraudDetectionService.getFraudStats();
      expect(stats.total).toBe(0);
    });
  });
});
