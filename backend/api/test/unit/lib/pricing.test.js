import { describe, it, expect } from 'vitest';
import {
  haversineKm,
  computeOrderPricing,
  convertKmToMiles,
  guardNonNegative,
} from '../../../src/lib/pricing.js';

// Note: sanitizePrice uses MIN_FREIGHT_PAISa/MAX_FREIGHT_PAISa which are not
// exported; tested indirectly through integration tests.

describe('haversineKm', () => {
  it('throws TypeError for non-finite arguments', () => {
    expect(() => haversineKm(NaN, 0, 0, 0)).toThrow(TypeError);
    expect(() => haversineKm(0, NaN, 0, 0)).toThrow(TypeError);
    expect(() => haversineKm(Infinity, 0, 0, 0)).toThrow(TypeError);
    expect(() => haversineKm(0, 0, 0, Infinity)).toThrow(TypeError);
  });

  it('returns 0 for identical points', () => {
    expect(haversineKm(0, 0, 0, 0)).toBe(0);
    expect(haversineKm(40.7, -74.0, 40.7, -74.0)).toBe(0);
  });

  it('returns a positive value for distinct points', () => {
    const d = haversineKm(40.7, -74.0, 51.5, -0.1);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(6000); // NYC to London is ~5570 km
  });

  it('is symmetric (A to B equals B to A)', () => {
    const d1 = haversineKm(40.7, -74.0, 51.5, -0.1);
    const d2 = haversineKm(51.5, -0.1, 40.7, -74.0);
    expect(Math.abs(d1 - d2)).toBeLessThan(0.001);
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

  it('throws TypeError for non-object input', () => {
    expect(() => computeOrderPricing(null)).toThrow(TypeError);
    expect(() => computeOrderPricing('string')).toThrow(TypeError);
  });

  it('throws RangeError for invalid weightTonnes', () => {
    expect(() => computeOrderPricing({
      pickupLat: 0, pickupLng: 0, dropLat: 0, dropLng: 0,
      weightTonnes: 0,
    })).toThrow(RangeError);
    expect(() => computeOrderPricing({
      pickupLat: 0, pickupLng: 0, dropLat: 0, dropLng: 0,
      weightTonnes: -10,
    })).toThrow(RangeError);
    expect(() => computeOrderPricing({
      pickupLat: 0, pickupLng: 0, dropLat: 0, dropLng: 0,
      weightTonnes: 'heavy',
    })).toThrow(RangeError);
  });

  it('throws for invalid rate card', () => {
    const badCard = { ratePerTonneKm: 0, handlingFee: 0 };
    expect(() => computeOrderPricing({
      pickupLat: 0, pickupLng: 0, dropLat: 1, dropLng: 1,
      weightTonnes: 10,
    }, badCard)).toThrow(RangeError);
  });

  it('computes base freight and total amount', () => {
    const result = computeOrderPricing({
      pickupLat: 0, pickupLng: 0, dropLat: 1, dropLng: 1,
      weightTonnes: 10,
      roadDistanceKm: 100,
    }, defaultRateCard);

    expect(result).toHaveProperty('baseFreight');
    expect(result).toHaveProperty('tollEstimate');
    expect(result).toHaveProperty('platformFee');
    expect(result).toHaveProperty('totalAmount');
    expect(result).toHaveProperty('fuelCost');
    expect(result).toHaveProperty('netProfit');
    expect(result.distanceKm).toBe(100);
    expect(result.totalAmount).toBeGreaterThan(result.baseFreight);
  });

  it('applies fragile multiplier', () => {
    const normal = computeOrderPricing({
      pickupLat: 0, pickupLng: 0, dropLat: 1, dropLng: 1,
      weightTonnes: 10,
      roadDistanceKm: 100,
      isFragile: false,
    }, defaultRateCard);

    const fragile = computeOrderPricing({
      pickupLat: 0, pickupLng: 0, dropLat: 1, dropLng: 1,
      weightTonnes: 10,
      roadDistanceKm: 100,
      isFragile: true,
    }, defaultRateCard);

    expect(fragile.baseFreight).toBeGreaterThan(normal.baseFreight);
  });

  it('applies stackable discount', () => {
    const normal = computeOrderPricing({
      pickupLat: 0, pickupLng: 0, dropLat: 1, dropLng: 1,
      weightTonnes: 10,
      roadDistanceKm: 100,
      isStackable: false,
    }, defaultRateCard);

    const stackable = computeOrderPricing({
      pickupLat: 0, pickupLng: 0, dropLat: 1, dropLng: 1,
      weightTonnes: 10,
      roadDistanceKm: 100,
      isStackable: true,
    }, defaultRateCard);

    expect(stackable.baseFreight).toBeLessThan(normal.baseFreight);
  });

  it('handles NaN tollFactor gracefully (defaults to 1)', () => {
    const result = computeOrderPricing({
      pickupLat: 0, pickupLng: 0, dropLat: 1, dropLng: 1,
      weightTonnes: 10,
      roadDistanceKm: 100,
      tollFactor: NaN,
    }, defaultRateCard);
    expect(result.tollEstimate).toBeGreaterThanOrEqual(0);
  });
});

describe('convertKmToMiles', () => {
  it('converts km to miles correctly', () => {
    expect(convertKmToMiles(1)).toBeCloseTo(0.621371, 5);
    expect(convertKmToMiles(100)).toBeCloseTo(62.1371, 3);
  });

  it('returns 0 for 0 km', () => {
    expect(convertKmToMiles(0)).toBe(0);
  });

  it('throws TypeError for non-finite km', () => {
    expect(() => convertKmToMiles(NaN)).toThrow(TypeError);
    expect(() => convertKmToMiles(Infinity)).toThrow(TypeError);
  });

  it('throws RangeError for negative km', () => {
    expect(() => convertKmToMiles(-10)).toThrow(RangeError);
  });
});

describe('guardNonNegative', () => {
  it('returns 0 for negative values', () => {
    expect(guardNonNegative(-10)).toBe(0);
    expect(guardNonNegative(-0.001)).toBe(0);
  });

  it('returns the value unchanged for non-negative finite numbers', () => {
    expect(guardNonNegative(0)).toBe(0);
    expect(guardNonNegative(100)).toBe(100);
    expect(guardNonNegative(99.9)).toBe(99.9);
  });

  it('throws TypeError for non-finite values', () => {
    expect(() => guardNonNegative(NaN)).toThrow(TypeError);
    expect(() => guardNonNegative(Infinity)).toThrow(TypeError);
    expect(() => guardNonNegative(-Infinity)).toThrow(TypeError);
  });
});
