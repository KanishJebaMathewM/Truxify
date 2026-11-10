import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

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
    dbMock.supabaseAdmin = { rpc: vi.fn().mockResolvedValue({ data: { total: 0, highRisk: 0, mediumRisk: 0, lowRisk: 0, avgScore: 0 }, error: null }) };
  });

  describe('getFraudStats', () => {
    it('returns zeros when supabaseAdmin is unavailable', async () => {
      dbMock.supabaseAdmin = null;
      const stats = await FraudDetectionService.getFraudStats();
      expect(stats).toEqual({ total: 0, highRisk: 0, mediumRisk: 0, lowRisk: 0, avgScore: 0 });
    });

    it('buckets scores into risk bands', async () => {
      dbMock.supabaseAdmin.rpc.mockResolvedValue({ data: { total: 3, highRisk: 1, mediumRisk: 1, lowRisk: 1, avgScore: (0.9 + 0.5 + 0.2) / 3 }, error: null });
      const stats = await FraudDetectionService.getFraudStats();
      expect(stats.total).toBe(3);
      expect(stats.highRisk).toBe(1);
      expect(stats.mediumRisk).toBe(1);
      expect(stats.lowRisk).toBe(1);
      expect(stats.avgScore).toBeCloseTo(0.533, 1);
    });

    it('loads complete totals through one aggregate RPC', async () => {
      await FraudDetectionService.getFraudStats();
      expect(dbMock.supabaseAdmin.rpc).toHaveBeenCalledTimes(1);
      expect(dbMock.supabaseAdmin.rpc).toHaveBeenCalledWith('get_fraud_stats_aggregate');
    });

    it('handles a null scores payload', async () => {
      dbMock.supabaseAdmin.rpc.mockResolvedValue({ data: null, error: null });
      const stats = await FraudDetectionService.getFraudStats();
      expect(stats.total).toBe(0);
    });

    it('completes without a row-pagination query builder', async () => {
      await expect(FraudDetectionService.getFraudStats()).resolves.toEqual({ total: 0, highRisk: 0, mediumRisk: 0, lowRisk: 0, avgScore: 0 });
    });

  });
});

afterAll(() => {
  FraudDetectionService.destroy();
  clearInterval(FraudDetectionService._flushInterval);
});
