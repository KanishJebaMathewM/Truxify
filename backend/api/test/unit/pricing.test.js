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
 *   - readRateCard returns defaults when no env vars are set
 *   - readRateCard parses custom env var values correctly
 *   - readRateCard falls back to defaults for empty-string or non-numeric env vars
 *   - DEFAULTS has expected static values and is frozen
 *
 * Run with:  npm run test:unit -- test/unit/pricing.test.js
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { haversineKm, computeOrderPricing } from '../../src/lib/pricing.js';

// Access private helpers via __testing
const { __testing } = await import('../../src/lib/pricing.js');
const { readRateCard, DEFAULTS } = __testing;

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

describe('readRateCard via __testing', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns defaults when no pricing env vars are set', () => {
    delete process.env.TRUXIFY_RATE_PER_TONNE_KM;
    delete process.env.TRUXIFY_FRAGILE_MULTIPLIER;
    delete process.env.TRUXIFY_STACKABLE_DISCOUNT;
    delete process.env.TRUXIFY_HANDLING_FEE;
    delete process.env.TRUXIFY_PLATFORM_FEE_PCT;
    delete process.env.TRUXIFY_FUEL_COST_PCT;
    delete process.env.TRUXIFY_TOLL_PER_KM;

    const card = readRateCard();

    expect(card.ratePerTonneKm).toBe(DEFAULTS.RATE_PER_TONNE_KM);
    expect(card.fragileMultiplier).toBe(DEFAULTS.FRAGILE_MULTIPLIER);
    expect(card.stackableDiscount).toBe(DEFAULTS.STACKABLE_DISCOUNT);
    expect(card.handlingFee).toBe(DEFAULTS.HANDLING_FEE);
    expect(card.platformFeePct).toBe(DEFAULTS.PLATFORM_FEE_PCT);
    expect(card.fuelCostPct).toBe(DEFAULTS.FUEL_COST_PCT);
    expect(card.tollPerKm).toBe(DEFAULTS.TOLL_PER_KM);
  });

  it('parses custom env var values correctly', () => {
    process.env.TRUXIFY_RATE_PER_TONNE_KM = '75';
    process.env.TRUXIFY_FRAGILE_MULTIPLIER = '2.0';
    process.env.TRUXIFY_STACKABLE_DISCOUNT = '0.85';
    process.env.TRUXIFY_HANDLING_FEE = '50000';
    process.env.TRUXIFY_PLATFORM_FEE_PCT = '10';
    process.env.TRUXIFY_FUEL_COST_PCT = '40';
    process.env.TRUXIFY_TOLL_PER_KM = '300';

    const card = readRateCard();

    expect(card.ratePerTonneKm).toBe(75);
    expect(card.fragileMultiplier).toBe(2.0);
    expect(card.stackableDiscount).toBe(0.85);
    expect(card.handlingFee).toBe(50000);
    expect(card.platformFeePct).toBe(10);
    expect(card.fuelCostPct).toBe(40);
    expect(card.tollPerKm).toBe(300);
  });

  it('falls back to defaults for empty-string env vars', () => {
    process.env.TRUXIFY_RATE_PER_TONNE_KM = '';
    process.env.TRUXIFY_FRAGILE_MULTIPLIER = '';
    process.env.TRUXIFY_TOLL_PER_KM = '';

    const card = readRateCard();

    expect(card.ratePerTonneKm).toBe(DEFAULTS.RATE_PER_TONNE_KM);
    expect(card.fragileMultiplier).toBe(DEFAULTS.FRAGILE_MULTIPLIER);
    expect(card.tollPerKm).toBe(DEFAULTS.TOLL_PER_KM);
  });

  it('falls back to defaults for non-numeric env vars', () => {
    process.env.TRUXIFY_RATE_PER_TONNE_KM = 'invalid';
    process.env.TRUXIFY_FRAGILE_MULTIPLIER = 'not-a-number';
    process.env.TRUXIFY_TOLL_PER_KM = 'NaN';

    const card = readRateCard();

    expect(card.ratePerTonneKm).toBe(DEFAULTS.RATE_PER_TONNE_KM);
    expect(card.fragileMultiplier).toBe(DEFAULTS.FRAGILE_MULTIPLIER);
    expect(card.tollPerKm).toBe(DEFAULTS.TOLL_PER_KM);
  });
});

describe('DEFAULTS constant', () => {
  it('has expected static values for all pricing parameters', () => {
    expect(DEFAULTS.RATE_PER_TONNE_KM).toBe(50);
    expect(DEFAULTS.FRAGILE_MULTIPLIER).toBe(1.5);
    expect(DEFAULTS.STACKABLE_DISCOUNT).toBe(0.9);
    expect(DEFAULTS.HANDLING_FEE).toBe(30000);
    expect(DEFAULTS.PLATFORM_FEE_PCT).toBe(5);
    expect(DEFAULTS.FUEL_COST_PCT).toBe(45);
    expect(DEFAULTS.TOLL_PER_KM).toBe(200);
  });

  it('is frozen to prevent accidental mutation', () => {
    expect(Object.isFrozen(DEFAULTS)).toBe(true);
  });
});
