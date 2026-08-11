import { normalizePhone } from '../../src/utils/phone.js';

describe('normalizePhone', () => {
  it('normalizes a plain 10-digit number to E.164', () => {
    expect(normalizePhone('9876543210')).toBe('+919876543210');
  });

  it('normalizes a +91 prefixed number', () => {
    expect(normalizePhone('+919876543210')).toBe('+919876543210');
  });

  it('normalizes a 91-prefixed number without plus', () => {
    expect(normalizePhone('919876543210')).toBe('+919876543210');
  });

  it('returns null for a 0-prefixed 11-digit number (not handled)', () => {
    expect(normalizePhone('09876543210')).toBeNull();
  });

  it('strips spaces and punctuation', () => {
    expect(normalizePhone('+91 98765 43210')).toBe('+919876543210');
    expect(normalizePhone('+91-98765-43210')).toBe('+919876543210');
  });

  it('returns null for empty input', () => {
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });

  it('returns null for non-string input', () => {
    expect(normalizePhone(9876543210)).toBeNull();
    expect(normalizePhone({})).toBeNull();
  });

  it('returns null for numbers that are too short', () => {
    expect(normalizePhone('98765')).toBeNull();
  });

  it('returns null for numbers that are too long', () => {
    expect(normalizePhone('98765432100')).toBeNull();
  });

  it('returns null for numbers with letters', () => {
    expect(normalizePhone('98765abc10')).toBeNull();
  });
});
