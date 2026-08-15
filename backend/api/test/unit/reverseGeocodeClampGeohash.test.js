import { describe, it, expect } from 'vitest';
import { clampGeohashPrecision } from '../../../src/lib/reverseGeocode.js';

describe('clampGeohashPrecision', () => {
  it('returns exact MIN boundary', () => {
    expect(clampGeohashPrecision(1)).toBe(1);
  });

  it('returns exact MAX boundary', () => {
    expect(clampGeohashPrecision(12)).toBe(12);
  });

  it('returns MIN when input is below minimum', () => {
    expect(clampGeohashPrecision(0)).toBe(1);
    expect(clampGeohashPrecision(-5)).toBe(1);
  });

  it('returns MAX when input is above maximum', () => {
    expect(clampGeohashPrecision(15)).toBe(12);
    expect(clampGeohashPrecision(100)).toBe(12);
  });

  it('returns default (6) for non-finite inputs', () => {
    expect(clampGeohashPrecision(NaN)).toBe(6);
    expect(clampGeohashPrecision(Infinity)).toBe(6);
    expect(clampGeohashPrecision(-Infinity)).toBe(6);
  });

  it('floors float inputs to integer', () => {
    expect(clampGeohashPrecision(3.9)).toBe(3);
    expect(clampGeohashPrecision(3.1)).toBe(3);
  });

  it('returns default for string inputs', () => {
    expect(clampGeohashPrecision('abc')).toBe(6);
  });

  it('returns exact default (6) for inputs at the default value', () => {
    expect(clampGeohashPrecision(6)).toBe(6);
  });
});
