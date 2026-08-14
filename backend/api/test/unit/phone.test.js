import { describe, it, expect } from 'vitest';
import { normalizePhone } from '../../src/utils/phone.js';

describe('phone utils', () => {
  describe('normalizePhone', () => {
    it('normalizes +91 prefixed number', () => {
      expect(normalizePhone('+919876543210')).toBe('+919876543210');
    });

    it('normalizes 0-prefixed number', () => {
      expect(normalizePhone('0919876543210')).toBe('+919876543210');
    });

    it('normalizes 10-digit number', () => {
      expect(normalizePhone('9876543210')).toBe('+919876543210');
    });

    it('normalizes number with spaces', () => {
      expect(normalizePhone('+91 98765 43210')).toBe('+919876543210');
    });

    it('returns null for null input', () => {
      expect(normalizePhone(null)).toBeNull();
    });

    it('returns null for undefined input', () => {
      expect(normalizePhone(undefined)).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(normalizePhone('')).toBeNull();
    });

    it('returns null for too short number', () => {
      expect(normalizePhone('98765')).toBeNull();
    });

    it('returns null for too long number', () => {
      expect(normalizePhone('987654321012')).toBeNull();
    });

    it('returns null for non-numeric string', () => {
      expect(normalizePhone('abcdefghij')).toBeNull();
    });
  });
});
