import { describe, it, expect } from 'vitest';
import { toPaisa, toInr, roundPrice } from '../../src/lib/priceRounding.js';

describe('priceRounding', () => {
  describe('toPaisa', () => {
    it('converts whole INR to paisa correctly', () => {
      expect(toPaisa(1)).toBe(100);
      expect(toPaisa(10)).toBe(1000);
      expect(toPaisa(100)).toBe(10000);
    });

    it('converts fractional INR to paisa correctly', () => {
      expect(toPaisa(1.5)).toBe(150);
      expect(toPaisa(0.01)).toBe(1);
      expect(toPaisa(0.99)).toBe(99);
    });

    it('rounds to nearest paisa', () => {
      // Use values that don't suffer from floating-point precision issues
      expect(toPaisa(1.5)).toBe(150);
      expect(toPaisa(1.49)).toBe(149);
      expect(toPaisa(1.994)).toBe(199);
    });

    it('returns null for invalid inputs', () => {
      expect(toPaisa(null)).toBeNull();
      expect(toPaisa(undefined)).toBeNull();
      expect(toPaisa(NaN)).toBeNull();
      expect(toPaisa(Infinity)).toBeNull();
      expect(toPaisa(-1)).toBeNull();
    });

    it('returns null for non-number inputs', () => {
      expect(toPaisa('100')).toBeNull();
      expect(toPaisa('abc')).toBeNull();
      expect(toPaisa({})).toBeNull();
    });
  });

  describe('toInr', () => {
    it('converts whole paisa to INR correctly', () => {
      expect(toInr(100)).toBe(1);
      expect(toInr(1000)).toBe(10);
    });

    it('converts fractional paisa to INR correctly', () => {
      expect(toInr(1)).toBe(0.01);
      expect(toInr(150)).toBe(1.5);
    });

    it('returns null for invalid inputs', () => {
      expect(toInr(null)).toBeNull();
      expect(toInr(undefined)).toBeNull();
      expect(toInr(NaN)).toBeNull();
      expect(toInr(-100)).toBeNull();
    });
  });

  describe('roundPrice', () => {
    it('rounds to 2 decimal places by default', () => {
      expect(roundPrice(1.234)).toBe(1.23);
      expect(roundPrice(1.235)).toBe(1.24);
      expect(roundPrice(1.999)).toBe(2);
    });

    it('rounds to specified decimal places', () => {
      expect(roundPrice(1.2345, 3)).toBe(1.235);
      expect(roundPrice(1.2344, 3)).toBe(1.234);
    });

    it('returns 0 for invalid inputs', () => {
      expect(roundPrice(null)).toBe(0);
      expect(roundPrice(undefined)).toBe(0);
      expect(roundPrice(NaN)).toBe(0);
    });
  });
});
