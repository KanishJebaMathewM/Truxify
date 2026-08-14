import { describe, it, expect } from 'vitest';
import { toPaisa, toInr, roundPrice } from '../../src/lib/priceRounding.js';

describe('toPaisa', () => {
  it('converts INR to paisa correctly', () => {
    expect(toPaisa(1)).toBe(100);
    expect(toPaisa(1.5)).toBe(150);
    expect(toPaisa(100)).toBe(10000);
  });

  it('returns null for negative values', () => {
    expect(toPaisa(-1)).toBeNull();
    expect(toPaisa(-0.01)).toBeNull();
  });

  it('returns null for non-finite values', () => {
    expect(toPaisa(NaN)).toBeNull();
    expect(toPaisa(Infinity)).toBeNull();
    expect(toPaisa(-Infinity)).toBeNull();
  });

  it('returns null for non-number input', () => {
    expect(toPaisa('100')).toBeNull();
    expect(toPaisa(null)).toBeNull();
    expect(toPaisa(undefined)).toBeNull();
  });

  it('handles zero', () => {
    expect(toPaisa(0)).toBe(0);
  });

  it('uses banker's rounding for .5 cases', () => {
    // Math.round uses banker's rounding in JS
    expect(toPaisa(1.005)).toBe(101); // 100.5 + EPSILON -> 101
  });
});

describe('toInr', () => {
  it('converts paisa to INR correctly', () => {
    expect(toInr(100)).toBe(1);
    expect(toInr(150)).toBe(1.5);
    expect(toInr(10000)).toBe(100);
  });

  it('returns null for negative values', () => {
    expect(toInr(-100)).toBeNull();
  });

  it('returns null for non-finite values', () => {
    expect(toInr(NaN)).toBeNull();
    expect(toInr(Infinity)).toBeNull();
  });

  it('handles zero', () => {
    expect(toInr(0)).toBe(0);
  });
});

describe('roundPrice', () => {
  it('rounds to 2 decimal places by default', () => {
    expect(roundPrice(1.234)).toBe(1.23);
    expect(roundPrice(1.235)).toBe(1.24);
  });

  it('respects custom decimal places', () => {
    expect(roundPrice(1.2345, 3)).toBe(1.235);
    expect(roundPrice(1.2345, 4)).toBe(1.2345);
  });

  it('returns 0 for non-finite values', () => {
    expect(roundPrice(NaN)).toBe(0);
    expect(roundPrice(Infinity)).toBe(0);
  });
});
