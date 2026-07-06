import { describe, it, expect } from 'vitest';
import { haversineKm, computeOrderPricing, convertKmToMiles, __testing } from '../../src/lib/pricing.js';

describe('Pricing Library', () => {
  describe('haversineKm', () => {
    it('returns 0 for identical points', () => {
      expect(haversineKm(10, 10, 10, 10)).toBe(0);
    });

    it('calculates accurate distance between two coordinates', () => {
      // New York to London approx 5570 km
      const distance = haversineKm(40.7128, -74.0060, 51.5074, -0.1278);
      expect(Math.round(distance)).toBe(5570);
    });

    it('throws TypeError for non-finite lat/lng', () => {
      expect(() => haversineKm(10, 10, 10, NaN)).toThrow(TypeError);
      expect(() => haversineKm(10, Infinity, 10, 10)).toThrow(TypeError);
    });
  });

  describe('computeOrderPricing', () => {
    const defaultRateCard = {
      ratePerTonneKm: 50,
      fragileMultiplier: 1.5,
      stackableDiscount: 0.9,
      handlingFee: 30000,
      platformFeePct: 5,
      fuelCostPct: 45,
      tollPerKm: 200,
    };

    it('throws TypeError if input is missing', () => {
      expect(() => computeOrderPricing(null)).toThrow(TypeError);
    });

    it('throws RangeError if weightTonnes is invalid', () => {
      expect(() => computeOrderPricing({ weightTonnes: 0 })).toThrow(RangeError);
      expect(() => computeOrderPricing({ weightTonnes: -10 })).toThrow(RangeError);
    });

    it('computes pricing with roadDistanceKm', () => {
      const input = {
        pickupLat: 10, pickupLng: 10, dropLat: 20, dropLng: 20,
        weightTonnes: 10, roadDistanceKm: 100
      };
      
      const pricing = computeOrderPricing(input, defaultRateCard);
      
      // baseFreight = (50 * 10 * 100) + 30000 = 50000 + 30000 = 80000
      expect(pricing.baseFreight).toBe(80000);
      
      // tollEstimate = 200 * 100 * 1 = 20000
      expect(pricing.tollEstimate).toBe(20000);
      
      // platformFee = (80000 * 5) / 100 = 4000
      expect(pricing.platformFee).toBe(4000);
      
      // totalAmount = 80000 + 20000 + 4000 = 104000
      expect(pricing.totalAmount).toBe(104000);
      
      // fuelCost = (80000 * 45) / 100 = 36000
      expect(pricing.fuelCost).toBe(36000);
      
      // netProfit = 80000 - 36000 - 20000 = 24000
      expect(pricing.netProfit).toBe(24000);
      
      expect(pricing.distanceKm).toBe(100);
    });

    it('applies fragile multiplier', () => {
      const input = {
        pickupLat: 10, pickupLng: 10, dropLat: 20, dropLng: 20,
        weightTonnes: 10, roadDistanceKm: 100, isFragile: true
      };
      const pricing = computeOrderPricing(input, defaultRateCard);
      // rate = 50 * 1.5 = 75
      // baseFreight = (75 * 10 * 100) + 30000 = 75000 + 30000 = 105000
      expect(pricing.baseFreight).toBe(105000);
    });

    it('applies stackable discount', () => {
      const input = {
        pickupLat: 10, pickupLng: 10, dropLat: 20, dropLng: 20,
        weightTonnes: 10, roadDistanceKm: 100, isStackable: true
      };
      const pricing = computeOrderPricing(input, defaultRateCard);
      // rate = 50 * 0.9 = 45
      // baseFreight = (45 * 10 * 100) + 30000 = 45000 + 30000 = 75000
      expect(pricing.baseFreight).toBe(75000);
    });
    
    it('uses haversine distance if roadDistanceKm is missing', () => {
      // 0,0 to 1,0 is exactly 1 degree lat ~ 111.19 km
      const input = {
        pickupLat: 0, pickupLng: 0, dropLat: 1, dropLng: 0,
        weightTonnes: 10
      };
      const distance = haversineKm(0, 0, 1, 0);
      const pricing = computeOrderPricing(input, defaultRateCard);
      expect(pricing.distanceKm).toBe(Math.round(distance * 100) / 100);
    });
  });

  describe('convertKmToMiles', () => {
    it('converts km to miles accurately', () => {
      expect(convertKmToMiles(1)).toBe(0.621371);
      expect(convertKmToMiles(100)).toBeCloseTo(62.1371, 4);
    });

    it('throws TypeError for invalid input', () => {
      expect(() => convertKmToMiles('100')).toThrow(TypeError);
      expect(() => convertKmToMiles(NaN)).toThrow(TypeError);
    });
  });
  
  describe('__testing', () => {
    it('readRateCard provides DEFAULTS when env missing', () => {
      const rateCard = __testing.readRateCard();
      expect(rateCard.ratePerTonneKm).toBe(__testing.DEFAULTS.RATE_PER_TONNE_KM);
    });
  });
});
