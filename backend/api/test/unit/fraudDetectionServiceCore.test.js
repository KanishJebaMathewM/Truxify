import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config/db.js', () => ({
  supabaseAdmin: { from: vi.fn() },
  supabase: null,
  redisClient: null,
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// FraudDetectionService is exported as a singleton instance
import FraudDetectionService from '../../src/services/fraud/FraudDetectionService.js';

describe('FraudDetectionService core', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getRiskLevel', () => {
    it('returns HIGH for score between 0.5 and 0.7', () => {
      expect(FraudDetectionService.getRiskLevel(0.5)).toBe('HIGH');
      expect(FraudDetectionService.getRiskLevel(0.65)).toBe('HIGH');
    });

    it('returns MEDIUM for score between 0.3 and 0.5', () => {
      expect(FraudDetectionService.getRiskLevel(0.4)).toBe('MEDIUM');
      expect(FraudDetectionService.getRiskLevel(0.3)).toBe('MEDIUM');
    });

    it('returns LOW for score below 0.3', () => {
      expect(FraudDetectionService.getRiskLevel(0.2)).toBe('LOW');
      expect(FraudDetectionService.getRiskLevel(0.0)).toBe('LOW');
    });

    it('returns CRITICAL for score >= 0.7', () => {
      expect(FraudDetectionService.getRiskLevel(0.7)).toBe('CRITICAL');
      expect(FraudDetectionService.getRiskLevel(0.9)).toBe('CRITICAL');
    });
  });

  describe('sanitizeUserId', () => {
    it('returns the userId when it contains no invalid characters', () => {
      expect(FraudDetectionService.sanitizeUserId('user-123')).toBe('user-123');
      expect(FraudDetectionService.sanitizeUserId('user_456')).toBe('user_456');
    });

    it('returns empty string for non-string input', () => {
      expect(FraudDetectionService.sanitizeUserId(null)).toBe('');
      expect(FraudDetectionService.sanitizeUserId(123)).toBe('');
    });

    it('returns empty string for userId with invalid characters', () => {
      expect(FraudDetectionService.sanitizeUserId('user,123')).toBe('');
      expect(FraudDetectionService.sanitizeUserId('user(123)')).toBe('');
    });
  });

  describe('calculateDistance', () => {
    it('returns a positive number for valid coordinates', () => {
      const distance = FraudDetectionService.calculateDistance(28.61, 77.23, 28.62, 77.24);
      expect(typeof distance).toBe('number');
      expect(distance).toBeGreaterThan(0);
    });

    it('returns 0 for identical coordinates', () => {
      const distance = FraudDetectionService.calculateDistance(28.61, 77.23, 28.61, 77.23);
      expect(distance).toBe(0);
    });
  });

  describe('getCacheStats', () => {
    it('returns cache statistics object', () => {
      const stats = FraudDetectionService.getCacheStats();
      expect(stats).toHaveProperty('riskScores');
      expect(stats).toHaveProperty('behavioralProfiles');
      expect(typeof stats.riskScores.size).toBe('number');
      expect(typeof stats.behavioralProfiles.size).toBe('number');
    });
  });
});



