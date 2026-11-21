import { describe, it, expect } from 'vitest';
import { parseStrictNumber } from '../../../src/lib/queryParams.js';

describe('parseStrictNumber', () => {
  it('accepts plain integers and decimals', () => {
    expect(parseStrictNumber('100')).toBe(100);
    expect(parseStrictNumber('100.5')).toBe(100.5);
    expect(parseStrictNumber('  42  ')).toBe(42);
  });

  it('accepts signed and exponent forms', () => {
    expect(parseStrictNumber('-3')).toBe(-3);
    expect(parseStrictNumber('+7.25')).toBe(7.25);
    expect(parseStrictNumber('1e3')).toBe(1000);
  });

  it('rejects numeric prefixes with trailing characters', () => {
    expect(parseStrictNumber('100abc')).toBeNull();
    expect(parseStrictNumber('100.5xyz')).toBeNull();
    expect(parseStrictNumber('12 INR')).toBeNull();
  });

  it('rejects empty, whitespace, and non-numeric values', () => {
    expect(parseStrictNumber('')).toBeNull();
    expect(parseStrictNumber('   ')).toBeNull();
    expect(parseStrictNumber('abc')).toBeNull();
  });

  it('rejects hex, Infinity, and unsafe numeric literals', () => {
    expect(parseStrictNumber('0x10')).toBeNull();
    expect(parseStrictNumber('Infinity')).toBeNull();
    expect(parseStrictNumber('NaN')).toBeNull();
  });

  it('enforces optional minimum and maximum bounds', () => {
    expect(parseStrictNumber('0', { min: 0 })).toBe(0);
    expect(parseStrictNumber('-1', { min: 0 })).toBeNull();
    expect(parseStrictNumber('101', { max: 100 })).toBeNull();
  });

  it('rejects non-string inputs so arrays are not coerced', () => {
    expect(parseStrictNumber(100)).toBeNull();
    expect(parseStrictNumber(['100'])).toBeNull();
    expect(parseStrictNumber(null)).toBeNull();
    expect(parseStrictNumber(undefined)).toBeNull();
  });
});
