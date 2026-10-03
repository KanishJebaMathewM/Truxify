import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseMock, MockQueryBuilder } from '../helpers/supabaseQueryMock.js';

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
    dbMock.supabaseAdmin = { from: vi.fn() } ;
    const mockClient = createSupabaseMock({
      tables: {
       fraud_stats: Array.from({length: 50}, (_, idx) => ({ id: 'id-' + idx, risk_score: idx * 2, severity: idx > 30 ? 'high' : 'low' })),
       users: [{ id: 'user-1', risk_score: 10 }]
      }
    });
    dbMock.supabaseAdmin = mockClient;
  });

  describe('getFraudStats', () => {
    it('returns zeros when supabaseAdmin is unavailable', async () => {
      dbMock.supabaseAdmin = null;
      const stats = await FraudDetectionService.getFraudStats();
      expect(stats).toEqual({ total: 0, highRisk: 0, mediumRisk: 0, lowRisk: 0, avgScore: 0 });
    });

    it('buckets scores into risk bands', async () => {
      dbMock.supabaseAdmin.from.mockReturnValue({
        select: vi.fn(() => ({ order: vi.fn(() => ({ range: vi.fn().mockResolvedValue({ data: [
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
      const range = vi.fn().mockResolvedValue({ data: [], });
      dbMock.supabaseAdmin.from.mockReturnValue({
        select: vi.fn(() => ({ order: vi.fn(() => ({ range })) })),
      });
      await FraudDetectionService.getFraudStats();
      expect(range).toHaveBeenCalledWith(0, 999);
    });

    it('handles a null scores payload', async () => {
      dbMock.supabaseAdmin.from.mockReturnValue({
        select: vi.fn(() => ({ order: vi.fn(() => ({ range: vi.fn().mockResolvedValue({ data: null }) })) })),
      });
      const stats = await FraudDetectionService.getFraudStats();
      expect(stats.total).toBe(0);
    });

    it('regression #10103: getFraudStats must not throw when .range() is called', async () => {
     const service = new FraudDetectionService();
     // This previously threw: TypeError: ...range is not a function
     await expect(service.getFraudStats({ page: 1, limit: 20 })).resolves.not.toThrow();
   });
  });
});
