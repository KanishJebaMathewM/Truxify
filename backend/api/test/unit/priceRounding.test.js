import { describe, it, expect } from 'vitest';
import { toPaisa, toInr, roundPrice } from '../../src/lib/priceRounding.js';

describe('toPaisa', () => {
  it('converts whole INR to paisa', () => {
    expect(toPaisa(100)).toBe(10000);
    expect(toPaisa(1)).toBe(100);
    expect(toPaisa(0)).toBe(0);
  });

  it('converts fractional INR to paisa with bank rounding', () => {
    expect(toPaisa(10.5)).toBe(1050);
    expect(toPaisa(10.555)).toBe(1056);  // rounds to nearest paisa
    expect(toPaisa(10.554)).toBe(1055);
    expect(toPaisa(10.5555)).toBe(1056);
  });

  it('handles very small INR values', () => {
    expect(toPaisa(0.01)).toBe(1);
    expect(toPaisa(0.005)).toBe(1);  // banker's rounding: 0.5 -> 0
    expect(toPaisa(0.015)).toBe(2);  // banker's rounding: 1.5 -> 2
  });

  it('returns null for null or undefined', () => {
    expect(toPaisa(null)).toBe(null);
    expect(toPaisa(undefined)).toBe(null);
  });

  it('returns null for non-number types', () => {
    expect(toPaisa('100')).toBe(null);
    expect(toPaisa('ten')).toBe(null);
    expect(toPaisa({})).toBe(null);
    expect(toPaisa([])).toBe(null);
    expect(toPaisa(true)).toBe(null);
  });

  it('returns null for NaN', () => {
    expect(toPaisa(NaN)).toBe(null);
  });

  it('returns null for negative INR', () => {
    expect(toPaisa(-1)).toBe(null);
    expect(toPaisa(-0.01)).toBe(null);
  });

  it('returns null for Infinity', () => {
    expect(toPaisa(Infinity)).toBe(null);
    expect(toPaisa(-Infinity)).toBe(null);
  });
});

describe('toInr', () => {
  it('converts whole paisa to INR', () => {
    expect(toInr(10000)).toBe(100);
    expect(toInr(100)).toBe(1);
    expect(toInr(0)).toBe(0);
  });

  it('converts fractional paisa to INR', () => {
    expect(toInr(1050)).toBe(10.5);
    expect(toInr(1)).toBe(0.01);
  });

  it('returns null for null or undefined', () => {
    expect(toInr(null)).toBe(null);
    expect(toInr(undefined)).toBe(null);
  });

  it('returns null for non-number types', () => {
    expect(toInr('10000')).toBe(null);
    expect(toInr({})).toBe(null);
    expect(toInr([])).toBe(null);
  });

  it('returns null for NaN', () => {
    expect(toInr(NaN)).toBe(null);
  });

  it('returns null for negative paisa', () => {
    expect(toInr(-1)).toBe(null);
    expect(toInr(-100)).toBe(null);
  });

  it('returns null for Infinity', () => {
    expect(toInr(Infinity)).toBe(null);
    expect(toInr(-Infinity)).toBe(null);
  });
});

describe('roundPrice', () => {
  it('rounds to 2 decimal places by default', () => {
    expect(roundPrice(10.555)).toBe(10.56);
    expect(roundPrice(10.554)).toBe(10.55);
    expect(roundPrice(10)).toBe(10);
  });

  it('rounds to specified decimal places', () => {
    expect(roundPrice(10.5555, 3)).toBe(10.556);
    expect(roundPrice(10.5555, 1)).toBe(10.6);
    expect(roundPrice(10.5555, 0)).toBe(11);
  });

  it('handles zero value', () => {
    expect(roundPrice(0)).toBe(0);
    expect(roundPrice(0, 3)).toBe(0);
  });

  it('returns 0 for NaN', () => {
    expect(roundPrice(NaN)).toBe(0);
  });

  it('returns 0 for Infinity', () => {
    expect(roundPrice(Infinity)).toBe(0);
    expect(roundPrice(-Infinity)).toBe(0);
  });

  it('returns 0 for non-number types', () => {
    expect(roundPrice('10.5')).toBe(0);
    expect(roundPrice(null)).toBe(0);
    expect(roundPrice(undefined)).toBe(0);
  });
});
