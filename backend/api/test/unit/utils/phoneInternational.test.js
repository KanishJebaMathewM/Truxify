import { describe, it, expect } from 'vitest';
import { normalizePhone } from '../../../src/utils/phone.js';

describe('normalizePhone international country code support', () => {
  it('normalizes international numbers with explicit + country code', () => {
    expect(normalizePhone('+1 202 555 0123')).toBe('+12025550123');
    expect(normalizePhone('+44 7911 123456')).toBe('+447911123456');
    expect(normalizePhone('+971 50 123 4567')).toBe('+971501234567');
  });

  it('rejects international numbers with fewer than 7 or more than 15 digits', () => {
    expect(normalizePhone('+1 23')).toBeNull();
    expect(normalizePhone('+123456789012345678')).toBeNull();
  });

  it('supports custom defaultCountryCode for 10-digit bare numbers', () => {
    expect(normalizePhone('9876543210', '1')).toBe('+19876543210');
    expect(normalizePhone('9876543210', '44')).toBe('+449876543210');
  });

  it('preserves default +91 behavior when defaultCountryCode is omitted', () => {
    expect(normalizePhone('9876543210')).toBe('+919876543210');
    expect(normalizePhone('+91 9876543210')).toBe('+919876543210');
    expect(normalizePhone('0919876543210')).toBe('+919876543210');
  });
});
