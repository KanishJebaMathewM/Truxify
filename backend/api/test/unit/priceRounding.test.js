import { describe, it, expect } from 'vitest';
import { toPaisa, toInr, roundPrice } from '../../src/lib/priceRounding.js';

describe('priceRounding', () => {
  describe('toPaisa', () => {
    it('converts whole INR amounts correctly', () => {
      expect(toPaisa(1)).toBe(100);
      expect(toPaisa(10)).toBe(1000);
      expect(toPaisa(100)).toBe(10000);
    });

    it('converts fractional INR amounts correctly with bank rounding', () => {
      expect(toPaisa(0.5)).toBe(50);
      expect(toPaisa(0.01)).toBe(1);
      expect(toPaisa(99.99)).toBe(9999);
      expect(toPaisa(123.456)).toBe(12346);
    });

    it('rounds correctly using Math.round behavior', () => {
      // 1.005 * 100 = 100.4999... which rounds to 100 in JS
      expect(toPaisa(1.004)).toBe(100);
      expect(toPaisa(1.006)).toBe(101);
    });

    it('returns null for zero', () => {
      expect(toPaisa(0)).toBe(0); // 0 is valid
    });

    it('returns null for negative amounts', () => {
      expect(toPaisa(-1)).toBeNull();
      expect(toPaisa(-0.01)).toBeNull();
    });

    it('returns null for NaN and Infinity', () => {
      expect(toPaisa(NaN)).toBeNull();
      expect(toPaisa(Infinity)).toBeNull();
      expect(toPaisa(-Infinity)).toBeNull();
    });

    it('returns null for non-number inputs', () => {
      expect(toPaisa(null)).toBeNull();
      expect(toPaisa(undefined)).toBeNull();
      expect(toPaisa('100')).toBeNull();
      expect(toPaisa({})).toBeNull();
    });
  });

  describe('toInr', () => {
    it('converts whole paisa amounts correctly', () => {
      expect(toInr(100)).toBe(1);
      expect(toInr(1000)).toBe(10);
      expect(toInr(10000)).toBe(100);
    });

    it('converts fractional paisa amounts correctly', () => {
      expect(toInr(1)).toBe(0.01);
      expect(toInr(50)).toBe(0.5);
      expect(toInr(12345)).toBe(123.45);
    });

    it('returns null for negative paisa', () => {
      expect(toInr(-1)).toBeNull();
      expect(toInr(-100)).toBeNull();
    });

    it('returns null for NaN and Infinity', () => {
      expect(toInr(NaN)).toBeNull();
      expect(toInr(Infinity)).toBeNull();
    });

    it('returns null for non-number inputs', () => {
      expect(toInr(null)).toBeNull();
      expect(toInr(undefined)).toBeNull();
      expect(toInr('100')).toBeNull();
    });
  });

  describe('roundPrice', () => {
    it('rounds to 2 decimal places by default', () => {
      expect(roundPrice(10.125)).toBe(10.13);
      expect(roundPrice(10.124)).toBe(10.12);
      expect(roundPrice(10)).toBe(10);
    });

    it('respects custom decimal precision', () => {
      expect(roundPrice(10.125, 1)).toBe(10.1);
      expect(roundPrice(10.125, 3)).toBe(10.125);
      expect(roundPrice(10.1256, 3)).toBe(10.126);
    });

    it('returns 0 for non-finite values', () => {
      expect(roundPrice(NaN)).toBe(0);
      expect(roundPrice(Infinity)).toBe(0);
      expect(roundPrice(-Infinity)).toBe(0);
    });

    it('returns 0 for non-number inputs', () => {
      expect(roundPrice(null)).toBe(0);
      expect(roundPrice(undefined)).toBe(0);
      expect(roundPrice('10.5')).toBe(0);
      expect(roundPrice({})).toBe(0);
    });

    it('handles zero and negative values', () => {
      expect(roundPrice(0)).toBe(0);
      // -10.4*100=-1040 is already integer, so returns -10.4
      expect(roundPrice(-10.4)).toBe(-10.4);
      // -10.459*100=-1045.9 rounds to -1046, giving -10.46
      expect(roundPrice(-10.459)).toBe(-10.46);
    });
  });
});
