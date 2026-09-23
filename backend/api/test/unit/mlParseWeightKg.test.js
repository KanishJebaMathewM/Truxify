import { describe, it, expect } from 'vitest';
import { __testing } from '../../src/services/ml.js';

const { parseWeightKg } = __testing;

describe('parseWeightKg', () => {
  it('parses numeric kilograms', () => {
    expect(parseWeightKg(100)).toBe(100);
    expect(parseWeightKg(0)).toBe(0);
  });

  it('requires an explicit unit for numeric strings', () => {
    expect(Number.isNaN(parseWeightKg('100'))).toBe(true);
    expect(Number.isNaN(parseWeightKg('0'))).toBe(true);
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
    expect(parseWeightKg('1.5 t')).toBe(1500);
  });

  it('returns NaN for unparseable strings', () => {
    expect(Number.isNaN(parseWeightKg('abc'))).toBe(true);
    expect(Number.isNaN(parseWeightKg(''))).toBe(true);
    expect(Number.isNaN(parseWeightKg('kg'))).toBe(true);
  });

  it('coerces null like Number and returns NaN for undefined', () => {
    expect(parseWeightKg(null)).toBe(0);
    expect(Number.isNaN(parseWeightKg(undefined))).toBe(true);
  });

  it('returns NaN for non-finite numbers', () => {
    expect(Number.isNaN(parseWeightKg(NaN))).toBe(true);
    expect(Number.isNaN(parseWeightKg(Infinity))).toBe(true);
  });

  it('coerces arrays like Number and returns NaN for objects', () => {
    expect(parseWeightKg([])).toBe(0);
    expect(Number.isNaN(parseWeightKg({}))).toBe(true);
  });
});