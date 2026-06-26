/**
 * Unit tests for backend/api/src/lib/pricing.js
 *
 * Coverage:
 *   - haversineKm returns 0 for identical points
 *   - haversineKm computes known distances correctly
 *   - haversineKm throws TypeError for non-finite inputs
 *   - computeOrderPricing happy path with all fields
 *   - computeOrderPricing applies fragile multiplier
 *   - computeOrderPricing applies stackable discount
 *   - computeOrderPricing uses roadDistanceKm when provided
 *   - computeOrderPricing falls back to haversine when roadDistanceKm is absent
 *   - computeOrderPricing throws RangeError for zero or negative weight
 *   - computeOrderPricing throws TypeError for non-object input
 *   - computeOrderPricing throws RangeError for zero computed rate
 *
 * Run with:  npm run test:unit -- test/unit/pricing.test.js
 */
import { describe, it, expect } from 'vitest';
import { haversineKm, computeOrderPricing } from '../../src/lib/pricing.js';

// Mumbai CST (19.0855, 72.8450) to Delhi NDLS (28.8428, 77.2781)
// Approximate great-circle distance: ~1154 km
const MUMBAI = { lat: 19.0855, lng: 72.8450 };
const DELHI  = { lat: 28.8428, lng: 77.2781 };

describe('haversineKm', () => {
  it('returns 0 for identical points', () => {
    expect(haversineKm(0, 0, 0, 0)).toBe(0);
    expect(haversineKm(19.0855, 72.8450, 19.0855, 72.8450)).toBe(0);
  });

  it('computes known distance between Mumbai and Delhi approximately correctly', () => {
    // Allow 5% tolerance for the slightly different Earth radius constant used
    const dist = haversineKm(MUMBAI.lat, MUMBAI.lng, DELHI.lat, DELHI.lng);
    expect(dist).toBeGreaterThan(1100);
    expect(dist).toBeLessThan(1200);
  });

  it('is symmetric (A to B equals B to A)', () => {
    const ab = haversineKm(MUMBAI.lat, MUMBAI.lng, DELHI.lat, DELHI.lng);
    const ba = haversineKm(DELHI.lat, DELHI.lng, MUMBAI.lat, MUMBAI.lng);
    expect(ab).toBeCloseTo(ba, 10);
  });

  it('throws TypeError for non-finite latitude', () => {
    expect(() => haversineKm(NaN, 72.8450, DELHI.lat, DELHI.lng)).toThrow(TypeError);
    expect(() => haversineKm(Infinity, 72.8450, DELHI.lat, DELHI.lng)).toThrow(TypeError);
  });

  it('throws TypeError for non-finite longitude', () => {
    expect(() => haversineKm(MUMBAI.lat, NaN, DELHI.lat, DELHI.lng)).toThrow(TypeError);
    expect(() => haversineKm(MUMBAI.lat, Infinity, DELHI.lat, DELHI.lng)).toThrow(TypeError);
  });
});

describe('computeOrderPricing', () => {
  const baseInput = {
    pickupLat: MUMBAI.lat,
    pickupLng: MUMBAI.lng,
    dropLat: DELHI.lat,
    dropLng: DELHI.lng,
    weightTonnes: 5,
  };

  const rateCard = {
    ratePerTonneKm: 50,
    fragileMultiplier: 1.5,
    stackableDiscount: 0.9,
    handlingFee: 30000,
    platformFeePct: 5,
    fuelCostPct: 45,
    tollPerKm: 200,
  };

  it('returns all pricing fields in paisa', () => {
    const result = computeOrderPricing(baseInput, rateCard);
    expect(result).toHaveProperty('distanceKm');
    expect(result).toHaveProperty('baseFreight');
    expect(result).toHaveProperty('tollEstimate');
    expect(result).toHaveProperty('platformFee');
    expect(result).toHaveProperty('totalAmount');
    expect(result).toHaveProperty('fuelCost');
    expect(result).toHaveProperty('netProfit');
    expect(result.distanceKm).toBeGreaterThan(0);
    expect(result.totalAmount).toBeGreaterThan(0);
  });

  it('applies fragile multiplier when isFragile is true', () => {
    const normal = computeOrderPricing(baseInput, rateCard);
    const fragile = computeOrderPricing({ ...baseInput, isFragile: true }, rateCard);
    expect(fragile.baseFreight).toBeGreaterThan(normal.baseFreight);
  });

  it('applies stackable discount when isStackable is true', () => {
    const normal = computeOrderPricing(baseInput, rateCard);
    const stackable = computeOrderPricing({ ...baseInput, isStackable: true }, rateCard);
    expect(stackable.baseFreight).toBeLessThan(normal.baseFreight);
  });

  it('uses roadDistanceKm when provided instead of haversine', () => {
    const withRoad = computeOrderPricing({ ...baseInput, roadDistanceKm: 1400 }, rateCard);
    const withoutRoad = computeOrderPricing(baseInput, rateCard);
    // roadDistanceKm > haversine distance for this route, so total should differ
    expect(withRoad.distanceKm).toBe(1400);
    expect(withRoad.distanceKm).not.toBeCloseTo(withoutRoad.distanceKm, 1);
  });

  it('falls back to haversine when roadDistanceKm is absent', () => {
    const result = computeOrderPricing(baseInput, rateCard);
    const haversineDist = haversineKm(MUMBAI.lat, MUMBAI.lng, DELHI.lat, DELHI.lng);
    expect(result.distanceKm).toBeCloseTo(haversineDist, 1);
  });

  it('throws RangeError for zero weight', () => {
    expect(() => computeOrderPricing({ ...baseInput, weightTonnes: 0 }, rateCard))
      .toThrow(RangeError);
  });

  it('throws RangeError for negative weight', () => {
    expect(() => computeOrderPricing({ ...baseInput, weightTonnes: -1 }, rateCard))
      .toThrow(RangeError);
  });

  it('throws TypeError when input is not an object', () => {
    expect(() => computeOrderPricing(null, rateCard)).toThrow(TypeError);
    expect(() => computeOrderPricing(undefined, rateCard)).toThrow(TypeError);
    expect(() => computeOrderPricing('not an object', rateCard)).toThrow(TypeError);
  });

  it('throws RangeError when computed rate is zero or negative', () => {
    const zeroRateCard = { ...rateCard, ratePerTonneKm: 0 };
    expect(() => computeOrderPricing(baseInput, zeroRateCard)).toThrow(RangeError);
  });

  it('totalAmount equals sum of baseFreight, tollEstimate, and platformFee', () => {
    const result = computeOrderPricing(baseInput, rateCard);
    expect(result.totalAmount).toBe(result.baseFreight + result.tollEstimate + result.platformFee);
  });

  it('netProfit equals baseFreight minus fuelCost minus tollEstimate', () => {
    const result = computeOrderPricing(baseInput, rateCard);
    expect(result.netProfit).toBe(result.baseFreight - result.fuelCost - result.tollEstimate);
  });
});
