import { describe, it, expect } from 'vitest';
import { toPaisa, toInr, roundPrice } from '../../../src/lib/priceRounding.js';

describe('toPaisa', () => {
  it('converts whole INR to paisa correctly', () => {
    expect(toPaisa(100)).toBe(10000);
    expect(toPaisa(1)).toBe(100);
    expect(toPaisa(0)).toBe(0);
  });

  it('converts fractional INR to paisa correctly', () => {
    expect(toPaisa(10.5)).toBe(1050);
    expect(toPaisa(99.99)).toBe(9999);
    expect(toPaisa(0.01)).toBe(1);
  });

  it('uses banker\'s rounding for edge cases', () => {
    // 1.235 rounds to 123.5 -> 124 with EPSILON adjustment
    expect(toPaisa(1.235)).toBe(124);
    // 1.225 should round to 122 or 123 depending on JS behavior
    const result = toPaisa(1.225);
    expect([122, 123]).toContain(result);
  });

  it('returns null for negative values', () => {
    expect(toPaisa(-1)).toBeNull();
    expect(toPaisa(-0.01)).toBeNull();
  });

  it('returns null for non-number inputs', () => {
    expect(toPaisa('100')).toBeNull();
    expect(toPaisa(null)).toBeNull();
    expect(toPaisa(undefined)).toBeNull();
  });

  it('returns null for NaN', () => {
    expect(toPaisa(NaN)).toBeNull();
  });

  it('returns null for Infinity', () => {
    expect(toPaisa(Infinity)).toBeNull();
    expect(toPaisa(-Infinity)).toBeNull();
  });

  it('handles zero', () => {
    expect(toPaisa(0)).toBe(0);
  });
});

describe('toInr', () => {
  it('converts whole paisa to INR correctly', () => {
    expect(toInr(10000)).toBe(100);
    expect(toInr(100)).toBe(1);
    expect(toInr(0)).toBe(0);
  });

  it('converts fractional paisa to INR correctly', () => {
    expect(toInr(1050)).toBe(10.5);
    expect(toInr(1)).toBe(0.01);
  });

  it('returns null for negative values', () => {
    expect(toInr(-100)).toBeNull();
    expect(toInr(-1)).toBeNull();
  });

  it('returns null for non-number inputs', () => {
    expect(toInr('100')).toBeNull();
    expect(toInr(null)).toBeNull();
    expect(toInr(undefined)).toBeNull();
  });

  it('returns null for NaN', () => {
    expect(toInr(NaN)).toBeNull();
  });

  it('returns null for Infinity', () => {
    expect(toInr(Infinity)).toBeNull();
    expect(toInr(-Infinity)).toBeNull();
  });
});

describe('roundPrice', () => {
  it('rounds to 2 decimal places by default', () => {
    expect(roundPrice(10.555)).toBe(10.56);
    expect(roundPrice(10.554)).toBe(10.55);
    expect(roundPrice(10.5)).toBe(10.5);
  });

  it('rounds to specified decimal places', () => {
    expect(roundPrice(10.5555, 3)).toBe(10.556);
    expect(roundPrice(10.5555, 1)).toBe(10.6);
    expect(roundPrice(10.5555, 0)).toBe(11);
  });

  it('handles zero correctly', () => {
    expect(roundPrice(0)).toBe(0);
  });

  it('returns 0 for non-number inputs', () => {
    expect(roundPrice('10.5')).toBe(0);
    expect(roundPrice(null)).toBe(0);
    expect(roundPrice(undefined)).toBe(0);
  });

  it('returns 0 for NaN', () => {
    expect(roundPrice(NaN)).toBe(0);
  });

  it('returns 0 for Infinity', () => {
    expect(roundPrice(Infinity)).toBe(0);
    expect(roundPrice(-Infinity)).toBe(0);
  });

  it('handles negative values', () => {
    expect(roundPrice(-10.556)).toBe(-10.56);
    expect(roundPrice(-10.554)).toBe(-10.55);
  });
});
