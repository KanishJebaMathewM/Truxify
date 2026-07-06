import { describe, it, expect } from 'vitest';
import {
  haversineKm,
  computeOrderPricing,
  convertKmToMiles,
  __testing
} from '../../src/lib/pricing.js';

describe('pricing.js', () => {
  describe('haversineKm', () => {
    it('returns 0 for identical coordinates', () => {
      expect(haversineKm(12.9716, 77.5946, 12.9716, 77.5946)).toBe(0);
    });

    it('calculates approximate distance between Bangalore and Chennai', () => {
      const distance = haversineKm(12.9716, 77.5946, 13.0827, 80.2707);
      expect(distance).toBeGreaterThan(280);
      expect(distance).toBeLessThan(310);
    });

    it('throws TypeError for non-finite lat/lng arguments', () => {
      expect(() => haversineKm('12.9', 77.5, 13.0, 80.2)).toThrow(TypeError);
      expect(() => haversineKm(NaN, 77.5, 13.0, 80.2)).toThrow(TypeError);
    });
  });

  describe('computeOrderPricing', () => {
    const defaultRateCard = __testing.DEFAULTS;

    it('calculates canonical order pricing with default rate card', () => {
      const result = computeOrderPricing({
        pickupLat: 12.9716,
        pickupLng: 77.5946,
        dropLat: 13.0827,
        dropLng: 80.2707,
        weightTonnes: 5,
        roadDistanceKm: 300,
      });

      // baseFreight = round(50 * 5 * 300) + 30000 = 75000 + 30000 = 105000 paisa (₹1050)
      expect(result.baseFreight).toBe(105000);
      // tollEstimate = round(200 * 300 * 1) = 60000 paisa (₹600)
      expect(result.tollEstimate).toBe(60000);
      // platformFee = round(105000 * 5 / 100) = 5250 paisa (₹52.5)
      expect(result.platformFee).toBe(5250);
      // totalAmount = 105000 + 60000 + 5250 = 170250 paisa (₹1702.50)
      expect(result.totalAmount).toBe(170250);
      expect(result.distanceKm).toBe(300);
    });

    it('applies fragile multiplier and stackable discount', () => {
      const fragileResult = computeOrderPricing({
        pickupLat: 12.9716,
        pickupLng: 77.5946,
        dropLat: 13.0827,
        dropLng: 80.2707,
        weightTonnes: 2,
        roadDistanceKm: 100,
        isFragile: true,
      });

      // rate = 50 * 1.5 = 75; baseFreight = 75 * 2 * 100 + 30000 = 15000 + 30000 = 45000
      expect(fragileResult.baseFreight).toBe(45000);
    });

    it('throws RangeError for invalid weightTonnes', () => {
      expect(() => computeOrderPricing({
        pickupLat: 12.9716,
        pickupLng: 77.5946,
        dropLat: 13.0827,
        dropLng: 80.2707,
        weightTonnes: 0,
      })).toThrow(RangeError);
    });
  });

  describe('convertKmToMiles', () => {
    it('converts km to miles accurately', () => {
      expect(convertKmToMiles(100)).toBeCloseTo(62.1371, 3);
    });

    it('throws TypeError for non-number inputs', () => {
      expect(() => convertKmToMiles('100')).toThrow(TypeError);
    });
  });
});
