import { describe, it, expect } from 'vitest';
import {
  computeOrderPricing,
  haversineKm,
  convertKmToMiles,
  sanitizePrice,
  __testing,
} from '../../src/lib/pricing.js';

describe('Pricing Service Unit Tests', () => {
  describe('sanitizePrice', () => {
    it('rounds and returns valid non-negative numbers', () => {
      expect(sanitizePrice(100)).toBe(100);
      expect(sanitizePrice(10.4)).toBe(10);
      expect(sanitizePrice(10.6)).toBe(11);
      expect(sanitizePrice(0)).toBe(0);
    });

    it('parses valid numeric strings', () => {
      expect(sanitizePrice('150')).toBe(150);
      expect(sanitizePrice('12.3')).toBe(12);
    });

    it('returns 0 for negative numbers', () => {
      expect(sanitizePrice(-50)).toBe(0);
      expect(sanitizePrice('-100')).toBe(0);
    });

    it('returns 0 for NaN, Infinity, null, and undefined', () => {
      expect(sanitizePrice(NaN)).toBe(0);
      expect(sanitizePrice(Infinity)).toBe(0);
      expect(sanitizePrice(-Infinity)).toBe(0);
      expect(sanitizePrice(null)).toBe(0);
      expect(sanitizePrice(undefined)).toBe(0);
      expect(sanitizePrice('invalid')).toBe(0);
    });
  });

  describe('haversineKm', () => {
    it('returns 0 for identical coordinates', () => {
      expect(haversineKm(10, 20, 10, 20)).toBe(0);
      expect(haversineKm(0, 0, 0, 0)).toBe(0);
    });

    it('calculates distance correctly (approx)', () => {
      // Delhi to Mumbai approx 1148 km straight line
      const dist = haversineKm(28.6139, 77.2090, 19.0760, 72.8777);
      expect(dist).toBeGreaterThan(1100);
      expect(dist).toBeLessThan(1200);
    });

    it('handles antipodal points (maximum Earth distance)', () => {
      const dist = haversineKm(0, 0, 0, 180);
      expect(dist).toBeCloseTo(Math.PI * 6371.0088, 1);
    });

    it('throws TypeError for non-numeric or non-finite coordinates', () => {
      expect(() => haversineKm('a', 20, 10, 20)).toThrow(TypeError);
      expect(() => haversineKm(10, null, 10, 20)).toThrow(TypeError);
      expect(() => haversineKm(10, 20, NaN, 20)).toThrow(TypeError);
      expect(() => haversineKm(10, 20, 10, Infinity)).toThrow(TypeError);
    });
  });

  describe('computeOrderPricing', () => {
    const defaultInput = {
      pickupLat: 10,
      pickupLng: 20,
      dropLat: 11,
      dropLng: 21,
      weightTonnes: 10,
      roadDistanceKm: 100, // 100 km for easy math
    };

    const mockRateCard = {
      ratePerTonneKm: 50, // 50 paisa
      fragileMultiplier: 1.5,
      stackableDiscount: 0.9,
      handlingFee: 30000,
      platformFeePct: 5,
      fuelCostPct: 45,
      tollPerKm: 200,
    };

    it('calculates standard pricing correctly', () => {
      const result = computeOrderPricing(defaultInput, mockRateCard);
      expect(result.baseFreight).toBe(80000);
      expect(result.tollEstimate).toBe(20000);
      expect(result.platformFee).toBe(4000);
      expect(result.totalAmount).toBe(104000);
      expect(result.fuelCost).toBe(36000);

      // netProfit = 80000 - 36000 = 44000 (toll is recovered from the customer
      // in totalAmount, so it must not be subtracted a second time)
      expect(result.netProfit).toBe(44000);
    });

    it('applies fragile multiplier correctly', () => {
      const input = { ...defaultInput, isFragile: true };
      const result = computeOrderPricing(input, mockRateCard);
      expect(result.baseFreight).toBe(105000);
    });

    it('applies stackable discount correctly', () => {
      const input = { ...defaultInput, isStackable: true };
      const result = computeOrderPricing(input, mockRateCard);
      expect(result.baseFreight).toBe(75000);
    });

    it('combines fragile and stackable modifiers correctly', () => {
      const input = { ...defaultInput, isFragile: true, isStackable: true };
      const result = computeOrderPricing(input, mockRateCard);
      expect(result.baseFreight).toBe(97500);
    });

    it('calculates pricing properly when roadDistanceKm is 0 (zero distance)', () => {
      const input = { ...defaultInput, roadDistanceKm: 0 };
      const result = computeOrderPricing(input, mockRateCard);
      expect(result.baseFreight).toBe(30000);
      expect(result.tollEstimate).toBe(0);
      expect(result.platformFee).toBe(1500);
      expect(result.totalAmount).toBe(31500);
    });

    it('falls back to haversine distance if roadDistanceKm is invalid/missing', () => {
      const input = {
        pickupLat: 0,
        pickupLng: 0,
        dropLat: 0.89932,
        dropLng: 0,
        weightTonnes: 10,
      };
      const result = computeOrderPricing(input, mockRateCard);
      expect(result.distanceKm).toBeGreaterThan(99);
      expect(result.distanceKm).toBeLessThan(101);
      expect(result.baseFreight).toBeGreaterThan(79000);
      expect(result.baseFreight).toBeLessThan(81000);
    });

    it('applies tollFactor correctly', () => {
      const input = { ...defaultInput, tollFactor: 1.5 };
      const result = computeOrderPricing(input, mockRateCard);
      expect(result.tollEstimate).toBe(30000);
    });

    it('handles extremely long distances gracefully', () => {
      const input = { ...defaultInput, roadDistanceKm: 100000 };
      const result = computeOrderPricing(input, mockRateCard);
      expect(result.baseFreight).toBe((50 * 10 * 100000) + 30000);
      expect(Number.isFinite(result.totalAmount)).toBe(true);
    });

    it('handles very large weights gracefully', () => {
      const input = { ...defaultInput, weightTonnes: 10000 };
      const result = computeOrderPricing(input, mockRateCard);
      expect(result.baseFreight).toBe((50 * 10000 * 100) + 30000);
      expect(Number.isFinite(result.totalAmount)).toBe(true);
    });

    it('throws TypeError if input is invalid', () => {
      expect(() => computeOrderPricing(null)).toThrow(TypeError);
      expect(() => computeOrderPricing(undefined)).toThrow(TypeError);
      expect(() => computeOrderPricing("string")).toThrow(TypeError);
    });

    it('throws RangeError for zero, negative, or non-finite weight', () => {
      expect(() => computeOrderPricing({ ...defaultInput, weightTonnes: 0 })).toThrow(RangeError);
      expect(() => computeOrderPricing({ ...defaultInput, weightTonnes: -5 })).toThrow(RangeError);
      expect(() => computeOrderPricing({ ...defaultInput, weightTonnes: NaN })).toThrow(RangeError);
    });

    it('throws RangeError if computed rate becomes <= 0', () => {
      const weirdRateCard = { ...mockRateCard, fragileMultiplier: 0 };
      const input = { ...defaultInput, isFragile: true };
      expect(() => computeOrderPricing(input, weirdRateCard)).toThrow(RangeError);
    });

    it('returns 0 for NaN or negative tollFactor instead of propagating NaN', () => {
      const resNaN = computeOrderPricing({ ...defaultInput, tollFactor: NaN });
      expect(resNaN.tollEstimate).toBe(20000); // defaults to tollFactor = 1

      const resNeg = computeOrderPricing({ ...defaultInput, tollFactor: -2 });
      expect(resNeg.tollEstimate).toBe(20000); // defaults to tollFactor = 1
    });

    it('returns 0 for undefined tollFactor (defaults to 1)', () => {
      const result = computeOrderPricing({ ...defaultInput, tollFactor: undefined });
      expect(Number.isFinite(result.tollEstimate)).toBe(true);
      expect(result.tollEstimate).toBeGreaterThanOrEqual(0);
    });

    it('does not subtract the toll from netProfit (toll is recovered from the customer)', () => {
      const result = computeOrderPricing(defaultInput, mockRateCard);
      // tollEstimate is non-zero (200 * 100 = 20000) and is already included in
      // totalAmount, so netProfit must equal baseFreight - fuelCost only.
      expect(result.tollEstimate).toBeGreaterThan(0);
      expect(result.netProfit).toBe(result.baseFreight - result.fuelCost);
    });

    it('does not return NaN in any field for valid inputs', () => {
      const result = computeOrderPricing(defaultInput);
      expect(Number.isFinite(result.baseFreight)).toBe(true);
      expect(Number.isFinite(result.tollEstimate)).toBe(true);
      expect(Number.isFinite(result.platformFee)).toBe(true);
      expect(Number.isFinite(result.totalAmount)).toBe(true);
      expect(Number.isFinite(result.fuelCost)).toBe(true);
      expect(Number.isFinite(result.netProfit)).toBe(true);
    });

    it('netProfit does not subtract tollEstimate since toll is a pass-through in totalAmount', () => {
      // Using defaultInput: baseFreight=80000, fuelCost=36000, tollEstimate=20000
      // totalAmount = 80000 + 20000 + 4000 = 104000 (toll included)
      // netProfit should = baseFreight - fuelCost = 80000 - 36000 = 44000
      // NOT baseFreight - fuelCost - tollEstimate = 80000 - 36000 - 20000 = 24000
      const result = computeOrderPricing(defaultInput, mockRateCard);
      expect(result.netProfit).toBe(44000);
      expect(result.netProfit).toBe(result.baseFreight - result.fuelCost);
      // Verify toll is still in totalAmount
      expect(result.totalAmount).toBe(result.baseFreight + result.tollEstimate + result.platformFee);
    });
  });

  describe('convertKmToMiles', () => {
    it('converts correctly', () => {
      expect(convertKmToMiles(0)).toBe(0);
      expect(convertKmToMiles(1)).toBe(0.621371);
      expect(convertKmToMiles(100)).toBeCloseTo(62.1371, 4);
    });

    it('throws TypeError for non-numeric or NaN', () => {
      expect(() => convertKmToMiles('100')).toThrow(TypeError);
      expect(() => convertKmToMiles(null)).toThrow(TypeError);
      expect(() => convertKmToMiles(undefined)).toThrow(TypeError);
      expect(() => convertKmToMiles(NaN)).toThrow(TypeError);
    });
  });
});
