import { describe, it, expect } from 'vitest';
import { clampMaxKeys } from '../../src/lib/lruCache.js';

describe('lruCache', () => {
  describe('clampMaxKeys', () => {
    it('returns fallback for non-finite input', () => {
      expect(clampMaxKeys(NaN)).toBe(1000);
      expect(clampMaxKeys(Infinity)).toBe(1000);
      expect(clampMaxKeys(-Infinity)).toBe(1000);
      expect(clampMaxKeys(undefined)).toBe(1000);
    });

    it('returns MIN_KEYS for values that coerce to below minimum', () => {
      // null coerces to 0, which is below MIN_KEYS=10
      expect(clampMaxKeys(null)).toBe(10);
    });

    it('returns fallback for non-numeric string input', () => {
      expect(clampMaxKeys('abc')).toBe(1000);
      expect(clampMaxKeys({})).toBe(1000);
    });

    it('returns MIN_KEYS for array (coerces to 0)', () => {
      // [] coerces to 0 via Number([]), 0 < MIN_KEYS=10
      expect(clampMaxKeys([])).toBe(10);
    });

    it('returns custom fallback for non-finite input', () => {
      expect(clampMaxKeys(NaN, 500)).toBe(500);
      expect(clampMaxKeys(Infinity, 250)).toBe(250);
    });

    it('returns MIN_KEYS for values below minimum', () => {
      expect(clampMaxKeys(0)).toBe(10);
      expect(clampMaxKeys(1)).toBe(10);
      expect(clampMaxKeys(5)).toBe(10);
      expect(clampMaxKeys(9)).toBe(10);
      expect(clampMaxKeys(-100)).toBe(10);
    });

    it('returns MAX_KEYS for values above maximum', () => {
      expect(clampMaxKeys(100_001)).toBe(100_000);
      expect(clampMaxKeys(1_000_000)).toBe(100_000);
      expect(clampMaxKeys(Number.MAX_SAFE_INTEGER)).toBe(100_000);
    });

    it('returns value unchanged when within range', () => {
      expect(clampMaxKeys(10)).toBe(10);
      expect(clampMaxKeys(50)).toBe(50);
      expect(clampMaxKeys(500)).toBe(500);
      expect(clampMaxKeys(1000)).toBe(1000);
      expect(clampMaxKeys(50_000)).toBe(50_000);
      expect(clampMaxKeys(99_999)).toBe(99_999);
      expect(clampMaxKeys(100_000)).toBe(100_000);
    });
  });
});
