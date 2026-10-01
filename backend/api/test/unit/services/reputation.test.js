import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReputationService } from '../../../src/services/reputation.js';

// Mock database and cache dependencies
vi.mock('../../../src/config/database.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
    })),
  },
}));

vi.mock('../../../src/lib/redis.js', () => ({
  redisClient: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  },
}));

describe('ReputationService', () => {
  let reputationService;

  beforeEach(() => {
    vi.clearAllMocks();
    reputationService = new ReputationService();
  });

  describe('getReputationScore & Score Normalization (0-100)', () => {
    it('should return a normalized score between 0 and 100 based on aggregated ratings', async () => {
      const mockDriverId = 'driver-123';
      const mockRatings = [
        { rating: 5 },
        { rating: 4 },
        { rating: 5 },
        { rating: 3 },
      ];

      vi.spyOn(reputationService, 'fetchDriverRatings').mockResolvedValue(mockRatings);

      const score = await reputationService.calculateNormalizedScore(mockDriverId);

      expect(score).toBeTypeOf('number');
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
      // (Average of [5, 4, 5, 3] = 4.25 / 5) * 100 = 85
      expect(score).toBe(85);
    });
  });

  describe('Neutral Score Edge Case (No Ratings)', () => {
    it('should return a default neutral score (e.g., 50 or 100) when a driver has zero ratings', async () => {
      const mockDriverId = 'driver-new';
      vi.spyOn(reputationService, 'fetchDriverRatings').mockResolvedValue([]);

      const score = await reputationService.calculateNormalizedScore(mockDriverId);

      expect(score).toBe(50); // Neutral baseline for brand new drivers
    });
  });

  describe('Rating Aggregation & Recalculation', () => {
    it('should correctly aggregate new feedback and update the cached/stored score', async () => {
      const mockDriverId = 'driver-456';
      const newRating = { rating: 5, comment: 'Excellent on-time delivery!' };

      vi.spyOn(reputationService, 'saveRatingToDb').mockResolvedValue(true);
      vi.spyOn(reputationService, 'recalculateScore').mockResolvedValue(95);

      const result = await reputationService.addRating(mockDriverId, newRating);

      expect(result.success).toBe(true);
      expect(result.newScore).toBe(95);
    });
  });

  describe('Cache TTL & Expiry Handling', () => {
    it('should return cached reputation score if cache is fresh', async () => {
      const mockDriverId = 'driver-123';
      const cachedData = JSON.stringify({ score: 88, cachedAt: Date.now() });

      const redisModule = await import('../../../src/lib/redis.js');
      redisModule.redisClient.get.mockResolvedValue(cachedData);

      const score = await reputationService.getReputationScore(mockDriverId);

      expect(score).toBe(88);
      expect(redisModule.redisClient.get).toHaveBeenCalledWith(`reputation:${mockDriverId}`);
    });

    it('should fallback to recalculation and update cache if cache is expired or missing', async () => {
      const mockDriverId = 'driver-123';
      const redisModule = await import('../../../src/lib/redis.js');
      redisModule.redisClient.get.mockResolvedValue(null); // Cache miss

      vi.spyOn(reputationService, 'calculateNormalizedScore').mockResolvedValue(90);

      const score = await reputationService.getReputationScore(mockDriverId);

      expect(score).toBe(90);
      expect(redisModule.redisClient.set).toHaveBeenCalled();
    });
  });
});
