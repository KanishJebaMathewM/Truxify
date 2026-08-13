import { describe, it, expect } from 'vitest';
import { normalizePhone } from '../../utils/phone.js';

describe('normalizePhone', () => {
  it('normalizes E.164 format with + prefix and space', () => {
    expect(normalizePhone('+91 9876543210')).toBe('+919876543210');
  });

  it('normalizes number with leading 0 trunk prefix', () => {
    expect(normalizePhone('0919876543210')).toBe('+919876543210');
  });

  it('normalizes plain 10-digit number', () => {
    expect(normalizePhone('9876543210')).toBe('+919876543210');
  });

  it('normalizes number with country code but no + prefix', () => {
    expect(normalizePhone('919876543210')).toBe('+919876543210');
  });

  it('returns null for too-short input', () => {
    expect(normalizePhone('987654321')).toBeNull();
  });

  it('returns null for too-long input', () => {
    expect(normalizePhone('91987654321099')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(normalizePhone(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(normalizePhone(undefined)).toBeNull();
  });

  it('returns null for non-string input', () => {
    expect(normalizePhone(9876543210)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(normalizePhone('')).toBeNull();
  });
});
