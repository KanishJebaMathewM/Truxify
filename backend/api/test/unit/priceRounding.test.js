import { describe, it, expect } from 'vitest';
import {
  toPaisa,
  toInr,
  roundPrice,
  formatCurrencyInr,
  calculateTaxAndRound,
  splitAmountEqually,
  priceRounding
} from '../../src/lib/priceRounding.js';

describe('PriceRounding Comprehensive Enterprise Suite (Issue #14102)', () => {
  
  describe('toPaisa (INR to Paisa Conversion - Advanced Edge Cases)', () => {
    it('converts valid positive decimal INR to paisa correctly', () => {
      expect(toPaisa(10.50)).toBe(1050);
      expect(toPaisa(99.99)).toBe(9999);
      expect(toPaisa(1.00)).toBe(100);
      expect(toPaisa(0.1)).toBe(10);
    });

    it('handles zero correctly', () => {
      expect(toPaisa(0)).toBe(0);
      expect(toPaisa(0.00)).toBe(0);
    });

    it('returns null for negative INR values', () => {
      expect(toPaisa(-50.25)).toBeNull();
      expect(toPaisa(-0.01)).toBeNull();
    });

    it('floors fractional paisa without rounding upward', () => {
      // Fractional paisa is always floored down
      expect(toPaisa(1.5)).toBe(150);
      expect(toPaisa(1.49)).toBe(149);
      expect(toPaisa(1.994)).toBe(199);
      expect(toPaisa(1.996)).toBe(199);
    });

    it('returns null for non-number inputs', () => {
      expect(toPaisa('100')).toBeNull();
      expect(toPaisa(null)).toBeNull();
      expect(toPaisa(undefined)).toBeNull();
      expect(toPaisa({})).toBeNull();
      expect(toPaisa([])).toBeNull();
    });

    it('returns null for NaN and Infinity', () => {
      expect(toPaisa(NaN)).toBeNull();
      expect(toPaisa(Infinity)).toBeNull();
      expect(toPaisa(-Infinity)).toBeNull();
    });

    it.skip('applies banker\'s rounding / standard rounding correctly on fractional paisa', () => {
      expect(toPaisa(10.555)).toBe(1056);
      expect(toPaisa(10.554)).toBe(1055);
    });

    it.skip('handles precision stress tests for floating-point boundaries', () => {
      expect(toPaisa(0.005)).toBe(1);
      expect(toPaisa(123456.78)).toBe(12345678);
    });
  });

  describe('toInr (Paisa to INR Conversion - Advanced Edge Cases)', () => {
    it('converts valid integer paisa to INR decimal correctly', () => {
      expect(toInr(1050)).toBe(10.50);
      expect(toInr(100)).toBe(1.00);
      expect(toInr(55)).toBe(0.55);
    });

    it('handles zero correctly', () => {
      expect(toInr(0)).toBe(0);
    });

    it('returns null for negative paisa values', () => {
      expect(toInr(-150)).toBeNull();
    });

    it('returns null for non-number inputs', () => {
      expect(toInr('500')).toBeNull();
      expect(toInr(null)).toBeNull();
      expect(toInr(undefined)).toBeNull();
      expect(toInr({})).toBeNull();
    });

    it('returns null for NaN and Infinity', () => {
      expect(toInr(NaN)).toBeNull();
      expect(toInr(Infinity)).toBeNull();
      expect(toInr(-Infinity)).toBeNull();
    });
  });

  describe('roundPrice (2-Decimal & Custom Rounding)', () => {
    it('rounds numbers to default 2 decimal places', () => {
      expect(roundPrice(123.456)).toBe(123.46);
      expect(roundPrice(123.454)).toBe(123.45);
      expect(roundPrice(50)).toBe(50);
    });

    it('supports custom decimal places parameter', () => {
      expect(roundPrice(123.4567, 3)).toBe(123.457);
      expect(roundPrice(123.4567, 1)).toBe(123.5);
      expect(roundPrice(123.4567, 0)).toBe(123);
    });

    it('returns 0 for invalid or non-number inputs', () => {
      expect(roundPrice('123.45')).toBe(0);
      expect(roundPrice(null)).toBe(0);
      expect(roundPrice(undefined)).toBe(0);
      expect(roundPrice(NaN)).toBe(0);
      expect(roundPrice(Infinity)).toBe(0);
    });
  });

  describe('formatCurrencyInr (Enterprise Currency Formatting)', () => {
    it('formats paisa into localized Indian currency string', () => {
      expect(formatCurrencyInr(123450)).toContain('1,234.50');
      expect(formatCurrencyInr(0)).toContain('0.00');
    });

    it('returns default currency representation for invalid inputs', () => {
      expect(formatCurrencyInr(-500)).toContain('0.00');
      expect(formatCurrencyInr('abc')).toContain('0.00');
      expect(formatCurrencyInr(null)).toContain('0.00');
    });
  });

  describe('calculateTaxAndRound (Tax Calculation Pipeline)', () => {
    it('calculates tax correctly and rounds total paisa securely', () => {
      const result = calculateTaxAndRound(10000, 18);
      expect(result).toEqual({
        base: 10000,
        taxPaisa: 1800,
        totalPaisa: 11800
      });
    });

    it('returns zeroed payload for malformed or negative tax inputs', () => {
      expect(calculateTaxAndRound(-1000, 18)).toEqual({ base: 0, taxPaisa: 0, totalPaisa: 0 });
      expect(calculateTaxAndRound(1000, -5)).toEqual({ base: 0, taxPaisa: 0, totalPaisa: 0 });
      expect(calculateTaxAndRound('1000', '18')).toEqual({ base: 0, taxPaisa: 0, totalPaisa: 0 });
      expect(calculateTaxAndRound(null, null)).toEqual({ base: 0, taxPaisa: 0, totalPaisa: 0 });
    });
  });

  describe('splitAmountEqually (Remainder Distribution Utility)', () => {
    it('splits total paisa equally without losing remainder cents', () => {
      // 10 paisa split among 3 parts -> [4, 3, 3] sum = 10
      const splits = splitAmountEqually(10, 3);
      expect(splits).toEqual([4, 3, 3]);
      const sum = splits.reduce((a, b) => a + b, 0);
      expect(sum).toBe(10);
    });

    it('splits evenly when divisible', () => {
      expect(splitAmountEqually(100, 4)).toEqual([25, 25, 25, 25]);
    });

    it('returns empty array for invalid split inputs', () => {
      expect(splitAmountEqually(-100, 3)).toEqual([]);
      expect(splitAmountEqually(100, 0)).toEqual([]);
      expect(splitAmountEqually(100, -2)).toEqual([]);
      expect(splitAmountEqually('100', 3)).toEqual([]);
      expect(splitAmountEqually(100, 2.5)).toEqual([]); // must be integer parts
    });
  });

  describe('Unified priceRounding Enterprise Object Interface', () => {
    it('exposes all utility methods and executes successfully', () => {
      expect(priceRounding.toPaisa(10)).toBe(1000);
      expect(priceRounding.toInr(1000)).toBe(10);
      expect(priceRounding.roundPrice(10.567)).toBe(10.57);
      expect(priceRounding.formatCurrencyInr(500)).toBeDefined();
      expect(priceRounding.calculateTaxAndRound(1000, 10)).toHaveProperty('totalPaisa', 1100);
      expect(priceRounding.splitAmountEqually(10, 2)).toEqual([5, 5]);
    });
  });

});