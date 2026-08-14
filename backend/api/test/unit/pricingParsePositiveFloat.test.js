import { describe, it, expect } from 'vitest';
import { __testing } from '../../../src/lib/pricing.js';

const { parsePositiveFloat } = __testing;

describe('parsePositiveFloat', () => {
  it('returns positive numbers unchanged', () => {
    expect(parsePositiveFloat(1.5)).toBe(1.5);
    expect(parsePositiveFloat(100)).toBe(100);
    expect(parsePositiveFloat(0.001)).toBe(0.001);
  });

  it('returns 0 as a valid value (fix: previously rejected zero)', () => {
    expect(parsePositiveFloat(0)).toBe(0);
  });

  it('returns fallback for null and undefined', () => {
    expect(parsePositiveFloat(null, 5)).toBe(5);
    expect(parsePositiveFloat(undefined, 5)).toBe(5);
    expect(parsePositiveFloat('', 5)).toBe(5);
  });

  it('returns fallback for negative numbers', () => {
    expect(parsePositiveFloat(-1, 5)).toBe(5);
    expect(parsePositiveFloat(-0.5, 5)).toBe(5);
  });

  it('returns fallback for NaN and non-finite', () => {
    expect(parsePositiveFloat(NaN, 5)).toBe(5);
    expect(parsePositiveFloat(Infinity, 5)).toBe(5);
    expect(parsePositiveFloat(-Infinity, 5)).toBe(5);
  });

  it('parses numeric strings', () => {
    expect(parsePositiveFloat('1.5', 5)).toBe(1.5);
    expect(parsePositiveFloat('0', 5)).toBe(0);
    expect(parsePositiveFloat('abc', 5)).toBe(5);
  });
});
