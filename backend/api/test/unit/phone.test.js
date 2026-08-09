import { describe, expect, it } from 'vitest';

import { normalizePhone } from '../../src/utils/phone.js';

describe('normalizePhone', () => {
  it('normalizes a leading-zero national number to E.164', () => {
    expect(normalizePhone('0919876543210')).toBe('+919876543210');
  });

  it('normalizes an international format with separators', () => {
    expect(normalizePhone('+91 9876543210')).toBe('+919876543210');
  });

  it('normalizes a bare 91-prefixed number', () => {
    expect(normalizePhone('919876543210')).toBe('+919876543210');
  });

  it('normalizes a plain 10-digit number', () => {
    expect(normalizePhone('9876543210')).toBe('+919876543210');
  });

  it('normalizes an already E.164 number unchanged', () => {
    expect(normalizePhone('+919876543210')).toBe('+919876543210');
  });

  it('returns null for a too-short number', () => {
    expect(normalizePhone('0987654321')).toBeNull();
  });

  it('returns null for non-string input', () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });
});
