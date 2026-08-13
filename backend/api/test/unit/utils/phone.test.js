import { describe, it, expect } from 'vitest';
import { normalizePhone } from '../../../src/utils/phone.js';

describe('normalizePhone', () => {
  it('normalizes 10-digit Indian numbers to E.164', () => {
    expect(normalizePhone('9876543210')).toBe('+919876543210');
  });

  it('normalizes numbers with +91 prefix', () => {
    expect(normalizePhone('+919876543210')).toBe('+919876543210');
    expect(normalizePhone('+91 9876543210')).toBe('+919876543210');
  });

  it('normalizes numbers with 0 prefix', () => {
    expect(normalizePhone('09876543210')).toBe('+919876543210');
  });

  it('handles numbers already with 91 prefix (12 digits)', () => {
    expect(normalizePhone('919876543210')).toBe('+919876543210');
  });

  it('returns null for invalid phone numbers', () => {
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('abcdefghij')).toBeNull();
    expect(normalizePhone('12345678901234')).toBeNull();
  });

  it('returns null for empty or null inputs', () => {
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });

  it('returns null for non-string inputs', () => {
    expect(normalizePhone(9876543210)).toBeNull();
  });
});
