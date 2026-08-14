import { describe, it, expect } from 'vitest';
import { __testing } from '../../../src/services/ml.js';

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

  it('returns NaN for unparseable strings', () => {
    expect(Number.isNaN(parseWeightKg('abc'))).toBe(true);
    expect(Number.isNaN(parseWeightKg(''))).toBe(true);
    expect(Number.isNaN(parseWeightKg('kg'))).toBe(true);
  });

  it('returns NaN for null and undefined', () => {
    expect(Number.isNaN(parseWeightKg(null))).toBe(true);
    expect(Number.isNaN(parseWeightKg(undefined))).toBe(true);
  });

  it('returns NaN for non-finite numbers', () => {
    expect(Number.isNaN(parseWeightKg(NaN))).toBe(true);
    expect(Number.isNaN(parseWeightKg(Infinity))).toBe(true);
  });

  it('returns NaN for objects and arrays', () => {
    expect(Number.isNaN(parseWeightKg({}))).toBe(true);
    expect(Number.isNaN(parseWeightKg([]))).toBe(true);
  });
});
