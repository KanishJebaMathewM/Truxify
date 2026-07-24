import { describe, it, expect } from 'vitest';
import { computeOrderPricing, haversineKm, convertKmToMiles, __testing } from '../../src/lib/pricing.js';

describe('Pricing Service Unit Tests', () => {
  describe('haversineKm', () => {
    it('returns 0 for identical coordinates', () => {
      expect(haversineKm(10, 20, 10, 20)).toBe(0);
    });

    it('calculates distance correctly (approx)', () => {
      // Delhi to Mumbai approx 1148 km straight line
      const dist = haversineKm(28.6139, 77.2090, 19.0760, 72.8777);
      expect(dist).toBeGreaterThan(1100);
      expect(dist).toBeLessThan(1200);
    });

    it('throws TypeError for non-numeric coordinates', () => {
      expect(() => haversineKm('a', 20, 10, 20)).toThrow(TypeError);
      expect(() => haversineKm(10, null, 10, 20)).toThrow(TypeError);
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
      // baseFreight = (50 * 10 * 100) + 30000 = 50000 + 30000 = 80000
      expect(result.baseFreight).toBe(80000);
      
      // tollEstimate = 200 * 100 * 1 = 20000
      expect(result.tollEstimate).toBe(20000);
      
      // platformFee = 5% of 80000 = 4000
      expect(result.platformFee).toBe(4000);
      
      // totalAmount = 80000 + 20000 + 4000 = 104000
      expect(result.totalAmount).toBe(104000);
      
      // fuelCost = 45% of 80000 = 36000
      expect(result.fuelCost).toBe(36000);
      
      // netProfit = 80000 - 36000 - 20000 = 24000
      expect(result.netProfit).toBe(24000);
    });

    it('applies fragile multiplier correctly', () => {
      const input = { ...defaultInput, isFragile: true };
      const result = computeOrderPricing(input, mockRateCard);
      // rate = 50 * 1.5 = 75
      // baseFreight = (75 * 10 * 100) + 30000 = 75000 + 30000 = 105000
      expect(result.baseFreight).toBe(105000);
    });

    it('applies stackable discount correctly', () => {
      const input = { ...defaultInput, isStackable: true };
      const result = computeOrderPricing(input, mockRateCard);
      // rate = 50 * 0.9 = 45
      // baseFreight = (45 * 10 * 100) + 30000 = 45000 + 30000 = 75000
      expect(result.baseFreight).toBe(75000);
    });

    it('combines fragile and stackable modifiers correctly', () => {
      const input = { ...defaultInput, isFragile: true, isStackable: true };
      const result = computeOrderPricing(input, mockRateCard);
      // rate = 50 * 1.5 * 0.9 = 67.5
      // baseFreight = (67.5 * 10 * 100) + 30000 = 67500 + 30000 = 97500
      expect(result.baseFreight).toBe(97500);
    });

    it('calculates pricing properly when roadDistanceKm is 0 (zero distance)', () => {
      const input = { ...defaultInput, roadDistanceKm: 0 };
      const result = computeOrderPricing(input, mockRateCard);
      // baseFreight = (50 * 10 * 0) + 30000 = 30000
      expect(result.baseFreight).toBe(30000);
      expect(result.tollEstimate).toBe(0);
      expect(result.platformFee).toBe(1500); // 5% of 30000
      expect(result.totalAmount).toBe(31500);
    });

    it('falls back to haversine distance if roadDistanceKm is invalid/missing', () => {
      // Create points exactly 100km apart
      const input = {
        pickupLat: 0,
        pickupLng: 0,
        dropLat: 0.89932, // Approx 100km on a great circle
        dropLng: 0,
        weightTonnes: 10,
        // no roadDistanceKm
      };
      const result = computeOrderPricing(input, mockRateCard);
      // distance should be ~100
      expect(result.distanceKm).toBeGreaterThan(99);
      expect(result.distanceKm).toBeLessThan(101);
      // baseFreight should be ~ (50 * 10 * 100) + 30000 = 80000
      expect(result.baseFreight).toBeGreaterThan(79000);
      expect(result.baseFreight).toBeLessThan(81000);
    });

    it('applies tollFactor correctly', () => {
      const input = { ...defaultInput, tollFactor: 1.5 };
      const result = computeOrderPricing(input, mockRateCard);
      // tollEstimate = 200 * 100 * 1.5 = 30000
      expect(result.tollEstimate).toBe(30000);
    });

    it('handles extremely long distances gracefully', () => {
      const input = { ...defaultInput, roadDistanceKm: 100000 };
      const result = computeOrderPricing(input, mockRateCard);
      expect(result.baseFreight).toBe((50 * 10 * 100000) + 30000);
    });

    it('throws TypeError if input is invalid', () => {
      expect(() => computeOrderPricing(null)).toThrow(TypeError);
      expect(() => computeOrderPricing(undefined)).toThrow(TypeError);
      expect(() => computeOrderPricing("string")).toThrow(TypeError);
    });

    it('throws RangeError for zero or negative weight', () => {
      expect(() => computeOrderPricing({ ...defaultInput, weightTonnes: 0 })).toThrow(RangeError);
      expect(() => computeOrderPricing({ ...defaultInput, weightTonnes: -5 })).toThrow(RangeError);
    });

    it('throws RangeError if computed rate becomes <= 0', () => {
      const weirdRateCard = { ...mockRateCard, fragileMultiplier: 0 };
      const input = { ...defaultInput, isFragile: true };
      expect(() => computeOrderPricing(input, weirdRateCard)).toThrow(RangeError);
    });
  });

  describe('convertKmToMiles', () => {
    it('converts correctly', () => {
      expect(convertKmToMiles(1)).toBe(0.621371);
      expect(convertKmToMiles(100)).toBeCloseTo(62.1371, 4);
    });

    it('throws TypeError for non-numeric', () => {
      expect(() => convertKmToMiles('100')).toThrow(TypeError);
      expect(() => convertKmToMiles(null)).toThrow(TypeError);
    });
  });
});
