import { describe, it, expect } from 'vitest';
import { __testing } from '../../src/services/ml.js';

const { parseWeightKg, parseWeightKgSafe, parseDimensions, _haversineKm } = __testing;

describe('ML parseWeightKg', () => {
  it('parses a plain numeric value', () => {
    expect(parseWeightKg(3000)).toBe(3000);
  });

  it('parses a kg string', () => {
    expect(parseWeightKg('3 kg')).toBe(3);
  });

  it('parses a tonne string to kilograms', () => {
    expect(parseWeightKg('3 tonne')).toBe(3000);
    expect(parseWeightKg('2.5 ton')).toBe(2500);
    expect(parseWeightKg('1t')).toBe(1000);
  });

  it('returns null for an unparseable value', () => {
    expect(parseWeightKg('heavy')).toBeNull();
    expect(parseWeightKg('abc123')).toBeNull();
  });
});

describe('ML parseWeightKgSafe', () => {
  it('returns parsed number for valid numeric and string inputs', () => {
    expect(parseWeightKgSafe(3000)).toBe(3000);
    expect(parseWeightKgSafe('500 kg')).toBe(500);
    expect(parseWeightKgSafe('250.5')).toBe(250.5);
  });

  it('returns defaultKg when input is null, undefined, unparseable, or non-positive', () => {
    expect(parseWeightKgSafe('not-a-weight')).toBe(1000);
    expect(parseWeightKgSafe(undefined)).toBe(1000);
    expect(parseWeightKgSafe(null)).toBe(1000);
    expect(parseWeightKgSafe(0)).toBe(1000);
    expect(parseWeightKgSafe(-100)).toBe(1000);
    expect(parseWeightKgSafe('invalid', 2500)).toBe(2500);
    expect(parseWeightKgSafe(null, 500)).toBe(500);
  });
});

describe('ML parseDimensions', () => {
  it('returns meter defaults when fewer than 3 numbers are present', () => {
    expect(parseDimensions('12 X 6')).toEqual({ length: 1, width: 1, height: 1 });
    expect(parseDimensions('none')).toEqual({ length: 1, width: 1, height: 1 });
    expect(parseDimensions(null)).toEqual({ length: 1, width: 1, height: 1 });
  });

  it('parses feet dimensions to meters', () => {
    const dims = parseDimensions('12 X 6 X 6 ft');
    expect(dims.length).toBeCloseTo(3.66, 1);
    expect(dims.width).toBeCloseTo(1.83, 1);
    expect(dims.height).toBeCloseTo(1.83, 1);
  });

  it('parses meter dimensions as-is', () => {
    const dims = parseDimensions('3 X 2 X 2 m');
    expect(dims).toEqual({ length: 3, width: 2, height: 2 });
  });
});

describe('ML _haversineKm', () => {
  it('returns 0 for identical points', () => {
    expect(_haversineKm(10, 20, 10, 20)).toBe(0);
  });

  it('returns a positive distance for distinct points', () => {
    const d = _haversineKm(28.6139, 77.209, 19.076, 72.8777);
    expect(d).toBeGreaterThan(1000);
    expect(d).toBeLessThan(1300);
  });
});
