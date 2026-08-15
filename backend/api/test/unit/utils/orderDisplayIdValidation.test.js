import { describe, it, expect } from 'vitest';
import { isValidDisplayId, getDisplayIdDate } from '../../../src/utils/orderDisplayIdValidation.js';

describe('orderDisplayIdValidation', () => {
  describe('isValidDisplayId', () => {
    it('returns true for valid display ID', () => {
      expect(isValidDisplayId('#FF20240101ABCD12345678')).toBe(true);
    });

    it('returns true for another valid display ID', () => {
      expect(isValidDisplayId('#FF20240813XYZ987654321')).toBe(true);
    });

    it('returns false for non-string input', () => {
      expect(isValidDisplayId(null)).toBe(false);
      expect(isValidDisplayId(undefined)).toBe(false);
      expect(isValidDisplayId(123)).toBe(false);
      expect(isValidDisplayId({})).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isValidDisplayId('')).toBe(false);
    });

    it('returns false for wrong prefix', () => {
      expect(isValidDisplayId('#XX20240101ABCD12345678')).toBe(false);
    });

    it('returns false for wrong length', () => {
      expect(isValidDisplayId('#FF20240101ABCD1234567')).toBe(false);
      expect(isValidDisplayId('#FF20240101ABCD123456789')).toBe(false);
    });

    it('returns false for lowercase letters', () => {
      expect(isValidDisplayId('#FF20240101abcd12345678')).toBe(false);
    });
  });

  describe('getDisplayIdDate', () => {
    it('returns YYYYMMDD from valid display ID', () => {
      expect(getDisplayIdDate('#FF20240101ABCD12345678')).toBe('20240101');
    });

    it('returns null for invalid display ID', () => {
      expect(getDisplayIdDate('not-a-display-id')).toBe(null);
      expect(getDisplayIdDate('')).toBe(null);
      expect(getDisplayIdDate(null)).toBe(null);
    });
  });
});
