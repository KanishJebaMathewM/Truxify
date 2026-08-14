import { describe, it, expect } from 'vitest';
import {
  clampReputation,
  clampRating,
  aggregateRating,
} from '../../src/services/reputation.js';

describe('reputation.js - pure helpers', () => {
  describe('clampReputation', () => {
    it('returns the value when within range', () => {
      expect(clampReputation(50)).toBe(50);
      expect(clampReputation(0)).toBe(0);
      expect(clampReputation(10000)).toBe(10000);
    });

    it('clamps values below 0 to 0', () => {
      expect(clampReputation(-10)).toBe(0);
      expect(clampReputation(-1)).toBe(0);
    });

    it('clamps values above MAX_REPUTATION to MAX_REPUTATION', () => {
      // MAX_REPUTATION = 10000
      expect(clampReputation(15000)).toBe(10000);
      expect(clampReputation(10001)).toBe(10000);
    });

    it('allows values within 0-MAX_REPUTATION range', () => {
      expect(clampReputation(150)).toBe(150);
      expect(clampReputation(10000)).toBe(10000);
    });

    it('handles NaN and non-numbers', () => {
      expect(clampReputation(NaN)).toBe(0);
      expect(clampReputation(undefined)).toBe(0);
    });
  });

  describe('clampRating', () => {
    it('returns the value when within 1-5 range', () => {
      expect(clampRating(3)).toBe(3);
      expect(clampRating(1)).toBe(1);
      expect(clampRating(5)).toBe(5);
    });

    it('clamps below 1 to 1', () => {
      expect(clampRating(0)).toBe(1);
      expect(clampRating(-2)).toBe(1);
    });

    it('clamps above 5 to 5', () => {
      expect(clampRating(6)).toBe(5);
      expect(clampRating(10)).toBe(5);
    });
  });

  describe('aggregateRating', () => {
    it('returns MIN_R for empty array', () => {
      const result = aggregateRating([]);
      // MIN_R is the minimum clamped rating (typically 1)
      expect(result).toBeGreaterThanOrEqual(1);
      expect(result).toBeLessThanOrEqual(5);
    });

    it('returns MIN_R when no ratings are finite numbers', () => {
      // Objects like {rating: 4} are not finite numbers, so filter returns []
      const result = aggregateRating([{ rating: 4 }]);
      expect(result).toBeGreaterThanOrEqual(1);
      expect(result).toBeLessThanOrEqual(5);
    });

    it('aggregates finite numeric ratings', () => {
      const result = aggregateRating([5, 3, 4]);
      expect(result).toBeCloseTo(4, 1);
    });
  });
});
