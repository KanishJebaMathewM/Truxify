import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFrom, mockRedisGet, mockRedisSetex } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockRedisGet: vi.fn(),
  mockRedisSetex: vi.fn(),
}));

vi.mock('../../src/config/db.js', () => ({
  supabase: { from: mockFrom },
  supabaseAdmin: { from: mockFrom },
  redisClient: {
    get: mockRedisGet,
    setex: mockRedisSetex,
  },
}));

describe('FraudDetectionService', () => {
  let FraudDetectionService;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    FraudDetectionService = (await import('../../src/services/fraud/FraudDetectionService.js')).default;
  });

  describe('getFraudStats', () => {
    it('returns fraud statistics summary', async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        count: vi.fn().mockResolvedValue({ count: 5 }),
      });

      const stats = await FraudDetectionService.getFraudStats();
      expect(stats).toHaveProperty('totalFlags');
      expect(stats).toHaveProperty('highRiskCount');
    });

    it('returns zero counts when no fraud records exist', async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        count: vi.fn().mockResolvedValue({ count: 0 }),
      });

      const stats = await FraudDetectionService.getFraudStats();
      expect(stats.totalFlags).toBe(0);
    });
  });

  describe('calculateBehavioralRisk', () => {
    it('returns low risk for profile with no flags', async () => {
      const profile = {
        user_id: 'user-1',
        fraud_score: 0.1,
        risk_level: 'low',
        events: [],
        patterns: { typingSpeed: [], locationHistory: [], transactionPatterns: [] },
      };
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      });

      const risk = await FraudDetectionService.calculateBehavioralRisk(profile);
      expect(risk).toBeLessThanOrEqual(1);
    });

    it('returns high risk when suspicious activity detected', async () => {
      const profile = {
        user_id: 'user-suspicious',
        fraud_score: 0.9,
        risk_level: 'high',
        events: [],
        patterns: { typingSpeed: [], locationHistory: [], transactionPatterns: [] },
      };
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      });

      const risk = await FraudDetectionService.calculateBehavioralRisk(profile);
      expect(risk).toBeGreaterThan(0.5);
    });
  });

  describe('analyzeNetwork', () => {
    it('returns network risk assessment', async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      });

      const network = await FraudDetectionService.analyzeNetwork('user-1');
      expect(network).toHaveProperty('networkRisk');
      expect(network).toHaveProperty('isInFraudRing');
    });
  });

  describe('trackBehavior', () => {
    it('records behavior without throwing', async () => {
      mockFrom.mockResolvedValue({ data: null, error: null });
      mockRedisGet.mockResolvedValue(null);

      await expect(
        FraudDetectionService.trackBehavior('user-test', {
          type: 'transaction',
          amount: 50,
          transactionType: 'pay',
        })
      ).resolves.not.toThrow();
    });
  });

  describe('flush', () => {
    it('calls _flushPendingUpserts without throwing', async () => {
      mockFrom.mockResolvedValue({ data: null, error: null });
      mockRedisGet.mockResolvedValue(null);

      await FraudDetectionService.trackBehavior('user-flush', {
        type: 'transaction',
        amount: 50,
        transactionType: 'pay',
      });

      await expect(FraudDetectionService._flushPendingUpserts()).resolves.not.toThrow();
    });
  });
});
