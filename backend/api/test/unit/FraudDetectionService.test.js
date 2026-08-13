import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFrom = vi.fn();
const mockRedisGet = vi.fn();
const mockRedisSetex = vi.fn();

vi.mock('../../src/config/db.js', () => ({
  supabase: { from: mockFrom },
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
      expect(stats).toHaveProperty('totalFlagged');
      expect(stats).toHaveProperty('totalReviewed');
    });
  });

  describe('getOrCreateProfile', () => {
    it('returns existing profile when found', async () => {
      const mockProfile = { user_id: 'user-1', fraud_score: 0.2, risk_level: 'low' };
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockProfile, error: null }),
      });

      const profile = await FraudDetectionService.getOrCreateProfile('user-1');
      expect(profile.user_id).toBe('user-1');
    });

    it('creates new profile when not found', async () => {
      mockFrom
        .mockReturnValueOnce({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } }),
        })
        .mockReturnValueOnce({
          insert: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { user_id: 'user-new', fraud_score: 0, risk_level: 'low' },
            error: null,
          }),
        });

      const profile = await FraudDetectionService.getOrCreateProfile('user-new');
      expect(profile.user_id).toBe('user-new');
    });
  });

  describe('calculateBehavioralRisk', () => {
    it('returns low risk for profile with no flags', async () => {
      const profile = { user_id: 'user-1', fraud_score: 0.1, risk_level: 'low' };
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
      const profile = { user_id: 'user-suspicious', fraud_score: 0.9, risk_level: 'high' };
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

    it('flags user as in fraud ring when many flagged neighbors exist', async () => {
      const flaggedNeighbors = [
        { user_id: 'neighbor-1', risk_level: 'high' },
        { user_id: 'neighbor-2', risk_level: 'high' },
        { user_id: 'neighbor-3', risk_level: 'high' },
      ];
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: flaggedNeighbors, error: null }),
      });

      const network = await FraudDetectionService.analyzeNetwork('user-ring');
      expect(network.isInFraudRing).toBe(true);
    });
  });
});
