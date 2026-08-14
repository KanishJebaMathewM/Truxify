import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isValidDisplayId } from '../../src/utils/orderDisplayIdValidation.js';

describe('orderDisplayIdValidation', () => {
  describe('isValidDisplayId', () => {
    it('returns true for a valid display ID format', () => {
      // Format: #FF + 8 digits + 12 alphanumeric = 22 chars total
      const valid = '#FF12345678ABCDEF123456';
      expect(isValidDisplayId(valid)).toBe(true);
    });

    it('returns false for wrong prefix', () => {
      expect(isValidDisplayId('#XX12345678ABCDEF123456')).toBe(false);
    });

    it('returns false for wrong length', () => {
      expect(isValidDisplayId('#FF12345678ABCDEF12')).toBe(false);
      expect(isValidDisplayId('#FF12345678ABCDEF1234567')).toBe(false);
    });

    it('returns false for non-string input', () => {
      expect(isValidDisplayId(null)).toBe(false);
      expect(isValidDisplayId(undefined)).toBe(false);
      expect(isValidDisplayId(12345)).toBe(false);
      expect(isValidDisplayId({})).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isValidDisplayId('')).toBe(false);
    });
  });
});
