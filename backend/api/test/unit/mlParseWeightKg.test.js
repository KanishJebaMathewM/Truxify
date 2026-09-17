import { describe, it, expect } from 'vitest';
import { __testing } from '../../src/services/ml.js';

const { parseWeightKg } = __testing;

describe('parseWeightKg', () => {
  it('parses numeric kilograms', () => {
    expect(parseWeightKg(100)).toBe(100);
    expect(parseWeightKg(0)).toBe(0);
  });

  it('parses numeric strings as kilograms', () => {
    expect(parseWeightKg('100')).toBe(100);
    expect(parseWeightKg('0')).toBe(0);
  });

  it('parses kg suffix', () => {
    expect(parseWeightKg('50 kg')).toBe(50);
    expect(parseWeightKg('50kg')).toBe(50);
    expect(parseWeightKg('50 KG')).toBe(50);
  });

  it('parses tonne suffix as kilograms', () => {
    expect(parseWeightKg('2 tonne')).toBe(2000);
    expect(parseWeightKg('2 ton')).toBe(2000);
    expect(parseWeightKg('1t')).toBe(1000);
    expect(parseWeightKg('1T')).toBe(1000);
  });

  it('returns null for unparseable strings', () => {
    expect(parseWeightKg('abc')).toBeNull();
    expect(parseWeightKg('')).toBeNull();
    expect(parseWeightKg('kg')).toBeNull();
  });

  it('returns null for null and undefined', () => {
    expect(parseWeightKg(null)).toBeNull();
    expect(parseWeightKg(undefined)).toBeNull();
  });

  it('returns null for non-finite numbers', () => {
    expect(parseWeightKg(NaN)).toBeNull();
    expect(parseWeightKg(Infinity)).toBeNull();
  });

  it('returns null for booleans, objects and arrays', () => {
    expect(parseWeightKg(true)).toBeNull();
    expect(parseWeightKg({})).toBeNull();
    expect(parseWeightKg([])).toBeNull();
  });
});
