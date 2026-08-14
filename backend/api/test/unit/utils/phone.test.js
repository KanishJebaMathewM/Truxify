import { describe, it, expect } from 'vitest';
import { normalizePhone } from '../../../src/utils/phone.js';

describe('normalizePhone', () => {
  it('returns null for null input', () => {
    expect(normalizePhone(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(normalizePhone(undefined)).toBeNull();
  });

  it('returns null for non-string input', () => {
    expect(normalizePhone(1234567890)).toBeNull();
    expect(normalizePhone({})).toBeNull();
    expect(normalizePhone([])).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(normalizePhone('')).toBeNull();
  });

  it('returns null for whitespace-only string', () => {
    expect(normalizePhone('   ')).toBeNull();
  });

  it('normalizes +91 prefix format', () => {
    expect(normalizePhone('+91 9876543210')).toBe('+919876543210');
    expect(normalizePhone('+919876543210')).toBe('+919876543210');
  });

  it('normalizes 0919876543210 format (trunk prefix)', () => {
    expect(normalizePhone('0919876543210')).toBe('+919876543210');
  });

  it('normalizes bare 10-digit number', () => {
    expect(normalizePhone('9876543210')).toBe('+919876543210');
  });

  it('normalizes 919876543210 format (already with country code)', () => {
    expect(normalizePhone('919876543210')).toBe('+919876543210');
  });

  it('strips spaces, dashes, and parentheses', () => {
    expect(normalizePhone('98765 43210')).toBe('+919876543210');
    expect(normalizePhone('987-654-3210')).toBe('+919876543210');
    expect(normalizePhone('(987) 654-3210')).toBe('+919876543210');
  });

  it('returns null for too few digits', () => {
    expect(normalizePhone('987654321')).toBeNull();
    expect(normalizePhone('987654')).toBeNull();
  });

  it('returns null for too many digits (without trunk prefix)', () => {
    expect(normalizePhone('987654321012')).toBeNull();
  });

  it('returns null for 11-digit bare number (leading 0 kept, exceeds 10 digits)', () => {
    // A bare number starting with 0 has 11 digits after stripping non-digits,
    // which exceeds the required 10-digit validation. This is intentional -
    // the function does not silently corrupt a bare 0-prefixed local number.
    expect(normalizePhone('09876543210')).toBeNull();
  });

  it('returns null for letters in phone number', () => {
    expect(normalizePhone('987654321A')).toBeNull();
    expect(normalizePhone('PHONE123')).toBeNull();
  });
});
