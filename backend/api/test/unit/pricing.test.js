/**
 * Unit tests for backend/api/src/lib/pricing.js
 *
 * Coverage:
 *   - DEFAULTS rate card
 *   - env-var overrides for all 7 rate-card fields
 *   - haversineKm: antipodes, identical points, invalid input
 *   - computeOrderPricing: fragile, stackable, combined modifiers
 *   - Input validation: zero/negative weight, NaN lat/lng, missing input
 *   - Output contract: exact shape, integer paisa, 2-decimal distance
 *
 * Run with:  npm test -- test/unit/pricing.test.js
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { computeOrderPricing, haversineKm, __testing } from '../../src/lib/pricing.js';

const { DEFAULTS, EARTH_RADIUS_KM } = __testing;

describe('pricing lib — defaults', () => {
  it('exposes the documented DEFAULTS rate card', () => {
    expect(DEFAULTS).toEqual({
      RATE_PER_TONNE_KM: 50,
      FRAGILE_MULTIPLIER: 1.5,
      STACKABLE_DISCOUNT: 0.9,
      HANDLING_FEE: 30000,
      PLATFORM_FEE_PCT: 5,
      FUEL_COST_PCT: 45,
      TOLL_PER_KM: 200,
    });
    expect(Object.isFrozen(DEFAULTS)).toBe(true);
  });

  it('uses an Earth radius consistent with the haversine implementation', () => {
    // Sanity: a full great-circle is roughly 2πR. We only assert
    // the same constant the lib uses, to catch a silent edit.
    expect(EARTH_RADIUS_KM).toBeGreaterThan(6370);
    expect(EARTH_RADIUS_KM).toBeLessThan(6372);
  });
});

describe('pricing lib — env-var override', () => {
  const envSnapshot = {};
  const ENV_KEYS = [
    'TRUXIFY_RATE_PER_TONNE_KM',
    'TRUXIFY_FRAGILE_MULTIPLIER',
    'TRUXIFY_STACKABLE_DISCOUNT',
    'TRUXIFY_HANDLING_FEE',
    'TRUXIFY_PLATFORM_FEE_PCT',
    'TRUXIFY_FUEL_COST_PCT',
    'TRUXIFY_TOLL_PER_KM',
  ];
  beforeEach(() => {
    for (const k of ENV_KEYS) envSnapshot[k] = process.env[k];
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (envSnapshot[k] === undefined) delete process.env[k];
      else process.env[k] = envSnapshot[k];
    }
  });

  it('reads all 7 env vars when set, falling back to defaults otherwise', () => {
    process.env.TRUXIFY_RATE_PER_TONNE_KM = '75';
    process.env.TRUXIFY_FRAGILE_MULTIPLIER = '2';
    process.env.TRUXIFY_STACKABLE_DISCOUNT = '0.8';
    process.env.TRUXIFY_HANDLING_FEE = '50000';
    process.env.TRUXIFY_PLATFORM_FEE_PCT = '10';
    process.env.TRUXIFY_FUEL_COST_PCT = '50';
    process.env.TRUXIFY_TOLL_PER_KM = '300';
    const r = __testing.readRateCard();
    expect(r).toEqual({
      ratePerTonneKm: 75,
      fragileMultiplier: 2,
      stackableDiscount: 0.8,
      handlingFee: 50000,
      platformFeePct: 10,
      fuelCostPct: 50,
      tollPerKm: 300,
    });
  });

  it('treats unset env vars as defaults', () => {
    for (const k of ENV_KEYS) delete process.env[k];
    const r = __testing.readRateCard();
    expect(r.ratePerTonneKm).toBe(DEFAULTS.RATE_PER_TONNE_KM);
    expect(r.handlingFee).toBe(DEFAULTS.HANDLING_FEE);
  });
});

describe('pricing lib — haversineKm', () => {
  it('returns 0 for identical points', () => {
    expect(haversineKm(28.6, 77.2, 28.6, 77.2)).toBe(0);
  });

  it('returns ~20015 km between antipodes (0,0 → 0,180)', () => {
    // Half the Earth's circumference using the lib's R.
    const expected = Math.PI * EARTH_RADIUS_KM;
    expect(haversineKm(0, 0, 0, 180)).toBeCloseTo(expected, 0);
  });

  it('Mumbai (19.0760, 72.8777) → Delhi (28.7041, 77.1025) is ~1150 km ±2%', () => {
    const d = haversineKm(19.0760, 72.8777, 28.7041, 77.1025);
    expect(d).toBeGreaterThan(1127);   // 1150 * 0.98
    expect(d).toBeLessThan(1173);      // 1150 * 1.02
  });

  it('is symmetric (A→B == B→A)', () => {
    const ab = haversineKm(19.0760, 72.8777, 28.7041, 77.1025);
    const ba = haversineKm(28.7041, 77.1025, 19.0760, 72.8777);
    expect(ab).toBeCloseTo(ba, 6);
  });

  it('throws TypeError on non-finite inputs', () => {
    expect(() => haversineKm(NaN, 0, 0, 0)).toThrow(TypeError);
    expect(() => haversineKm(0, Infinity, 0, 0)).toThrow(TypeError);
    expect(() => haversineKm(0, 0, 'x', 0)).toThrow(TypeError);
  });
});

describe('pricing lib — computeOrderPricing', () => {
  // Mumbai → Delhi great-circle, ~1147 km.
  const mumbaiDelhi = {
    pickupLat: 19.0760, pickupLng: 72.8777,
    dropLat:   28.7041, dropLng:   77.1025,
    weightTonnes: 10,
  };

  it('returns the documented output shape and nothing else', () => {
    const p = computeOrderPricing(mumbaiDelhi);
    expect(Object.keys(p).sort()).toEqual(
      ['baseFreight', 'distanceKm', 'fuelCost', 'netProfit', 'platformFee', 'tollEstimate', 'totalAmount']
    );
  });

  it('returns integer paisa for every monetary field', () => {
    const p = computeOrderPricing(mumbaiDelhi);
    for (const k of ['baseFreight', 'tollEstimate', 'platformFee', 'totalAmount', 'fuelCost', 'netProfit']) {
      expect(Number.isInteger(p[k]), `${k} should be integer, got ${p[k]}`).toBe(true);
    }
  });

  it('distance is rounded to 2 decimal places', () => {
    const p = computeOrderPricing(mumbaiDelhi);
    expect(p.distanceKm).toBe(Math.round(p.distanceKm * 100) / 100);
  });

  it('Mumbai → Delhi, 10 tonnes, no flags: all-positive amounts, total = base + toll + platform', () => {
    const p = computeOrderPricing(mumbaiDelhi);
    expect(p.distanceKm).toBeGreaterThan(1100);
    expect(p.distanceKm).toBeLessThan(1200);
    expect(p.baseFreight).toBeGreaterThan(0);
    expect(p.tollEstimate).toBeGreaterThan(0);
    expect(p.platformFee).toBeGreaterThan(0);
    expect(p.totalAmount).toBe(p.baseFreight + p.tollEstimate + p.platformFee);
  });

  it('fragile multiplier increases baseFreight by exactly FRAGILE_MULTIPLIER', () => {
    const plain   = computeOrderPricing(mumbaiDelhi, { ...DEFAULTS, ratePerTonneKm: 50, fragileMultiplier: 1.5, stackableDiscount: 0.9, handlingFee: 30000, platformFeePct: 5, fuelCostPct: 45, tollPerKm: 200 });
    const fragile = computeOrderPricing({ ...mumbaiDelhi, isFragile: true },
                                          { ...DEFAULTS, ratePerTonneKm: 50, fragileMultiplier: 1.5, stackableDiscount: 0.9, handlingFee: 30000, platformFeePct: 5, fuelCostPct: 45, tollPerKm: 200 });
    // baseFreight = round(rate * weight * distance) + handlingFee.
    // fragile increases the *rate* by 1.5; the handlingFee is flat.
    // So the rate-driven part of baseFreight should be 1.5x larger.
    const ratePartPlain   = plain.baseFreight   - 30000;
    const ratePartFragile = fragile.baseFreight - 30000;
    expect(ratePartFragile).toBe(Math.round(ratePartPlain * 1.5));
  });

  it('stackable discount decreases baseFreight by STACKABLE_DISCOUNT (multiplier < 1)', () => {
    const card = { ...DEFAULTS, ratePerTonneKm: 50, fragileMultiplier: 1.5, stackableDiscount: 0.9, handlingFee: 30000, platformFeePct: 5, fuelCostPct: 45, tollPerKm: 200 };
    const plain     = computeOrderPricing(mumbaiDelhi, card);
    const stackable = computeOrderPricing({ ...mumbaiDelhi, isStackable: true }, card);
    const ratePartPlain     = plain.baseFreight     - 30000;
    const ratePartStackable = stackable.baseFreight - 30000;
    expect(ratePartStackable).toBe(Math.round(ratePartPlain * 0.9));
  });

  it('fragile + stackable compose (multipliers multiply, not sum)', () => {
    const card = { ...DEFAULTS, ratePerTonneKm: 50, fragileMultiplier: 1.5, stackableDiscount: 0.9, handlingFee: 30000, platformFeePct: 5, fuelCostPct: 45, tollPerKm: 200 };
    const both = computeOrderPricing({ ...mumbaiDelhi, isFragile: true, isStackable: true }, card);
    const ratePartBoth = both.baseFreight - 30000;
    const ratePartPlain = (() => {
      const r = computeOrderPricing(mumbaiDelhi, card);
      return r.baseFreight - 30000;
    })();
    // 1.5 * 0.9 = 1.35, so both should be 1.35× the plain rate-part.
    // Allow ±1 paisa for compounding rounding (the two round()s happen
    // at different multiplications, not the same intermediate value).
    expect(ratePartBoth).toBeGreaterThanOrEqual(Math.round(ratePartPlain * 1.35) - 1);
    expect(ratePartBoth).toBeLessThanOrEqual(Math.round(ratePartPlain * 1.35) + 1);
  });

  it('fuelCost + tollEstimate + netProfit = baseFreight (driver-side ledger)', () => {
    const p = computeOrderPricing(mumbaiDelhi);
    // netProfit = baseFreight - fuelCost - tollEstimate
    // → baseFreight = fuelCost + tollEstimate + netProfit
    expect(p.fuelCost + p.tollEstimate + p.netProfit).toBe(p.baseFreight);
  });

  it('throws RangeError on weightTonnes = 0', () => {
    expect(() => computeOrderPricing({ ...mumbaiDelhi, weightTonnes: 0 }))
      .toThrow(RangeError);
  });

  it('throws RangeError on negative weightTonnes', () => {
    expect(() => computeOrderPricing({ ...mumbaiDelhi, weightTonnes: -5 }))
      .toThrow(RangeError);
  });

  it('throws RangeError on NaN weightTonnes', () => {
    expect(() => computeOrderPricing({ ...mumbaiDelhi, weightTonnes: NaN }))
      .toThrow(RangeError);
  });

  it('throws TypeError on non-object input', () => {
    expect(() => computeOrderPricing(null)).toThrow(TypeError);
    expect(() => computeOrderPricing('hello')).toThrow(TypeError);
    expect(() => computeOrderPricing(42)).toThrow(TypeError);
  });

  it('throws when lat/lng are not finite (proxies through haversineKm)', () => {
    expect(() => computeOrderPricing({ ...mumbaiDelhi, dropLat: NaN }))
      .toThrow(TypeError);
  });

  it('throws when the composed rate is zero or negative', () => {
    // stackableDiscount = 0 → rate = 0 → must throw
    const card = { ...DEFAULTS, ratePerTonneKm: 50, fragileMultiplier: 1.5, stackableDiscount: 0, handlingFee: 30000, platformFeePct: 5, fuelCostPct: 45, tollPerKm: 200 };
    expect(() => computeOrderPricing({ ...mumbaiDelhi, isStackable: true }, card))
      .toThrow(RangeError);
  });
});
