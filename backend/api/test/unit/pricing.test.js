import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  computeOrderPricing,
  haversineKm,
  safePaisa,
  sanitizePrice,
  convertKmToMiles,
  guardNonNegative,
  __testing,
} from '../../src/lib/pricing.js';

const { DEFAULTS, readRateCard, EARTH_RADIUS_KM } = __testing;

describe('Pricing Engine (#1513)', () => {
  let originalEnv;

  beforeEach(() => {
    // Snapshot environment to restore after each test
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    // Restore environment
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  // ── haversineKm ───────────────────────────────────────────────────────────

  describe('haversineKm (distance calculation)', () => {
    it('returns 0 for identical coordinates', () => {
      const distance = haversineKm(28.6139, 77.2090, 28.6139, 77.2090);
      expect(distance).toBe(0);
    });

    it('calculates known distance accurately (Delhi to Mumbai)', () => {
      // Delhi: 28.6139° N, 77.2090° E
      // Mumbai: 19.0760° N, 72.8777° E
      // Known great-circle distance: ~1150 km
      const distance = haversineKm(28.6139, 77.2090, 19.0760, 72.8777);
      expect(distance).toBeGreaterThan(1100);
      expect(distance).toBeLessThan(1200);
    });

    it('calculates known distance accurately (Chennai to Bangalore)', () => {
      // Chennai: 13.0827° N, 80.2707° E
      // Bangalore: 12.9716° N, 77.5946° E
      // Known distance: ~290 km
      const distance = haversineKm(13.0827, 80.2707, 12.9716, 77.5946);
      expect(distance).toBeGreaterThan(280);
      expect(distance).toBeLessThan(300);
    });

    it('handles antipodal points (maximum distance)', () => {
      // North Pole to South Pole should be ~20,000 km (half circumference)
      const distance = haversineKm(90, 0, -90, 0);
      expect(distance).toBeGreaterThan(19900);
      expect(distance).toBeLessThan(20100);
    });

    it('handles crossing the prime meridian', () => {
      const distance = haversineKm(0, -1, 0, 1);
      expect(distance).toBeGreaterThan(200);
      expect(distance).toBeLessThan(250);
    });

    it('handles crossing the international date line', () => {
      const distance = haversineKm(0, 179, 0, -179);
      expect(distance).toBeGreaterThan(200);
      expect(distance).toBeLessThan(250);
    });

    it('handles crossing the equator', () => {
      const distance = haversineKm(-1, 0, 1, 0);
      expect(distance).toBeGreaterThan(220);
      expect(distance).toBeLessThan(230);
    });

    it('throws TypeError for non-finite latitude', () => {
      expect(() => haversineKm(NaN, 0, 0, 0)).toThrow(TypeError);
      expect(() => haversineKm(Infinity, 0, 0, 0)).toThrow(TypeError);
    });

    it('throws TypeError for non-finite longitude', () => {
      expect(() => haversineKm(0, NaN, 0, 0)).toThrow(TypeError);
      expect(() => haversineKm(0, 0, 0, Infinity)).toThrow(TypeError);
    });

    it('throws TypeError for string inputs', () => {
      expect(() => haversineKm('28.6', '77.2', '19.0', '72.8')).toThrow(TypeError);
    });

    it('throws TypeError for null inputs', () => {
      expect(() => haversineKm(null, 0, 0, 0)).toThrow(TypeError);
    });

    it('throws TypeError for undefined inputs', () => {
      expect(() => haversineKm(undefined, 0, 0, 0)).toThrow(TypeError);
    });

    it('is symmetric (A→B equals B→A)', () => {
      const d1 = haversineKm(28.6139, 77.2090, 19.0760, 72.8777);
      const d2 = haversineKm(19.0760, 72.8777, 28.6139, 77.2090);
      expect(d1).toBe(d2);
    });

    it('obeys triangle inequality', () => {
      // A (Delhi), B (Mumbai), C (Bangalore)
      const dAB = haversineKm(28.6139, 77.2090, 19.0760, 72.8777);
      const dBC = haversineKm(19.0760, 72.8777, 12.9716, 77.5946);
      const dAC = haversineKm(28.6139, 77.2090, 12.9716, 77.5946);
      expect(dAC).toBeLessThanOrEqual(dAB + dBC);
    });
  });

  // ── safePaisa ─────────────────────────────────────────────────────────────

  describe('safePaisa (currency safety)', () => {
    it('returns 0 for negative values', () => {
      expect(safePaisa(-100)).toBe(0);
      expect(safePaisa(-0.01)).toBe(0);
    });

    it('returns 0 for NaN', () => {
      expect(safePaisa(NaN)).toBe(0);
    });

    it('returns 0 for Infinity', () => {
      expect(safePaisa(Infinity)).toBe(0);
      expect(safePaisa(-Infinity)).toBe(0);
    });

    it('returns 0 for non-numeric strings', () => {
      expect(safePaisa('abc')).toBe(0);
      expect(safePaisa('')).toBe(0);
    });

    it('parses numeric strings correctly', () => {
      expect(safePaisa('10000')).toBe(10000);
      expect(safePaisa('1234.56')).toBe(1235); // rounded
    });

    it('rounds to nearest integer (paisa is integer unit)', () => {
      expect(safePaisa(100.4)).toBe(100);
      expect(safePaisa(100.5)).toBe(101);
      expect(safePaisa(100.6)).toBe(101);
    });

    it('handles zero correctly', () => {
      expect(safePaisa(0)).toBe(0);
      expect(safePaisa('0')).toBe(0);
    });

    it('handles large values', () => {
      expect(safePaisa(100_000_000)).toBe(100_000_000);
    });

    it('handles very small positive values', () => {
      expect(safePaisa(0.01)).toBe(0);
      expect(safePaisa(0.5)).toBe(1);
    });
  });

  // ── sanitizePrice ─────────────────────────────────────────────────────────

  describe('sanitizePrice (price bounds)', () => {
    it('clamps to MAX_FREIGHT_PAISa ceiling (₹10,00,000)', () => {
      const result = sanitizePrice(200_000_000);
      expect(result).toBe(100_000_000);
    });

    it('clamps negative values to 0', () => {
      expect(sanitizePrice(-1000)).toBe(0);
      expect(sanitizePrice(-0.01)).toBe(0);
    });

    it('returns 0 for NaN', () => {
      expect(sanitizePrice(NaN)).toBe(0);
    });

    it('returns 0 for Infinity', () => {
      expect(sanitizePrice(Infinity)).toBe(0);
    });

    it('passes through valid values unchanged', () => {
      expect(sanitizePrice(50000)).toBe(50000);
      expect(sanitizePrice(0)).toBe(0);
    });

    it('rounds to integer', () => {
      expect(sanitizePrice(123.45)).toBe(123);
      expect(sanitizePrice(123.5)).toBe(124);
    });
  });

  // ── guardNonNegative ──────────────────────────────────────────────────────

  describe('guardNonNegative', () => {
    it('returns 0 for negative values', () => {
      expect(guardNonNegative(-5, 'amount')).toBe(0);
    });

    it('returns value for positive numbers', () => {
      expect(guardNonNegative(100, 'amount')).toBe(100);
    });

    it('returns 0 for zero', () => {
      expect(guardNonNegative(0, 'amount')).toBe(0);
    });

    it('throws TypeError for NaN', () => {
      expect(() => guardNonNegative(NaN, 'amount')).toThrow(TypeError);
    });

    it('throws TypeError for Infinity', () => {
      expect(() => guardNonNegative(Infinity, 'amount')).toThrow(TypeError);
    });

    it('includes label in error message', () => {
      expect(() => guardNonNegative(NaN, 'weightTonnes')).toThrow(/weightTonnes/);
    });
  });

  // ── convertKmToMiles ──────────────────────────────────────────────────────

  describe('convertKmToMiles', () => {
    it('converts accurately (1 km ≈ 0.621371 miles)', () => {
      const miles = convertKmToMiles(1);
      expect(miles).toBeCloseTo(0.621371, 5);
    });

    it('converts 100 km correctly', () => {
      const miles = convertKmToMiles(100);
      expect(miles).toBeCloseTo(62.1371, 3);
    });

    it('handles zero', () => {
      expect(convertKmToMiles(0)).toBe(0);
    });

    it('throws TypeError for non-number', () => {
      expect(() => convertKmToMiles('100')).toThrow(TypeError);
      expect(() => convertKmToMiles(null)).toThrow(TypeError);
    });

    it('throws TypeError for NaN', () => {
      expect(() => convertKmToMiles(NaN)).toThrow(TypeError);
    });

    it('throws TypeError for Infinity', () => {
      expect(() => convertKmToMiles(Infinity)).toThrow(TypeError);
    });

    it('throws RangeError for negative values', () => {
      expect(() => convertKmToMiles(-1)).toThrow(RangeError);
    });
  });

  // ── computeOrderPricing (CORE FINANCIAL LOGIC) ────────────────────────────

  describe('computeOrderPricing (main pricing function)', () => {
    const validInput = {
      pickupLat: 28.6139,
      pickupLng: 77.2090,
      dropLat: 19.0760,
      dropLng: 72.8777,
      weightTonnes: 10,
    };

    const defaultRateCard = {
      ratePerTonneKm: DEFAULTS.RATE_PER_TONNE_KM,
      fragileMultiplier: DEFAULTS.FRAGILE_MULTIPLIER,
      stackableDiscount: DEFAULTS.STACKABLE_DISCOUNT,
      handlingFee: DEFAULTS.HANDLING_FEE,
      platformFeePct: DEFAULTS.PLATFORM_FEE_PCT,
      fuelCostPct: DEFAULTS.FUEL_COST_PCT,
      tollPerKm: DEFAULTS.TOLL_PER_KM,
    };

    describe('input validation', () => {
      it('throws TypeError for null input', () => {
        expect(() => computeOrderPricing(null)).toThrow(TypeError);
      });

      it('throws TypeError for non-object input', () => {
        expect(() => computeOrderPricing('invalid')).toThrow(TypeError);
        expect(() => computeOrderPricing(123)).toThrow(TypeError);
      });

      it('throws RangeError for non-positive weightTonnes', () => {
        expect(() => computeOrderPricing({ ...validInput, weightTonnes: 0 })).toThrow(RangeError);
        expect(() => computeOrderPricing({ ...validInput, weightTonnes: -5 })).toThrow(RangeError);
      });

      it('throws RangeError for NaN weightTonnes', () => {
        expect(() => computeOrderPricing({ ...validInput, weightTonnes: NaN })).toThrow(RangeError);
      });

      it('throws TypeError when pickup coordinates missing', () => {
        const input = { ...validInput };
        delete input.pickupLat;
        expect(() => computeOrderPricing(input)).toThrow(TypeError);
      });

      it('throws TypeError when drop coordinates missing', () => {
        const input = { ...validInput };
        delete input.dropLng;
        expect(() => computeOrderPricing(input)).toThrow(TypeError);
      });

      it('throws TypeError for null coordinates', () => {
        expect(() => computeOrderPricing({ ...validInput, pickupLat: null })).toThrow(TypeError);
      });

      it('throws RangeError for invalid rate card (ratePerTonneKm <= 0)', () => {
        const badCard = { ...defaultRateCard, ratePerTonneKm: 0 };
        expect(() => computeOrderPricing(validInput, badCard)).toThrow(RangeError);
      });

      it('throws RangeError for negative handlingFee', () => {
        const badCard = { ...defaultRateCard, handlingFee: -100 };
        expect(() => computeOrderPricing(validInput, badCard)).toThrow(RangeError);
      });
    });

    describe('basic pricing calculation', () => {
      it('returns all required pricing fields', () => {
        const result = computeOrderPricing(validInput, defaultRateCard);
        expect(result).toHaveProperty('distanceKm');
        expect(result).toHaveProperty('baseFreight');
        expect(result).toHaveProperty('tollEstimate');
        expect(result).toHaveProperty('platformFee');
        expect(result).toHaveProperty('totalAmount');
        expect(result).toHaveProperty('fuelCost');
        expect(result).toHaveProperty('netProfit');
      });

      it('returns positive baseFreight for valid input', () => {
        const result = computeOrderPricing(validInput, defaultRateCard);
        expect(result.baseFreight).toBeGreaterThan(0);
      });

      it('returns positive tollEstimate for valid input', () => {
        const result = computeOrderPricing(validInput, defaultRateCard);
        expect(result.tollEstimate).toBeGreaterThan(0);
      });

      it('returns positive platformFee for valid input', () => {
        const result = computeOrderPricing(validInput, defaultRateCard);
        expect(result.platformFee).toBeGreaterThan(0);
      });

      it('totalAmount equals sum of components', () => {
        const result = computeOrderPricing(validInput, defaultRateCard);
        const expectedTotal = result.baseFreight + result.tollEstimate + result.platformFee;
        expect(result.totalAmount).toBe(expectedTotal);
      });

      it('platformFee is percentage of baseFreight', () => {
        const result = computeOrderPricing(validInput, defaultRateCard);
        const expectedFee = Math.round((result.baseFreight * defaultRateCard.platformFeePct) / 100);
        expect(result.platformFee).toBe(expectedFee);
      });

      it('fuelCost is percentage of baseFreight', () => {
        const result = computeOrderPricing(validInput, defaultRateCard);
        const expectedFuel = Math.round((result.baseFreight * defaultRateCard.fuelCostPct) / 100);
        expect(result.fuelCost).toBe(expectedFuel);
      });

      it('netProfit is baseFreight minus fuelCost', () => {
        const result = computeOrderPricing(validInput, defaultRateCard);
        expect(result.netProfit).toBe(result.baseFreight - result.fuelCost);
      });

      it('all returned values are finite integers (paisa)', () => {
        const result = computeOrderPricing(validInput, defaultRateCard);
        expect(Number.isInteger(result.baseFreight)).toBe(true);
        expect(Number.isInteger(result.tollEstimate)).toBe(true);
        expect(Number.isInteger(result.platformFee)).toBe(true);
        expect(Number.isInteger(result.totalAmount)).toBe(true);
        expect(Number.isInteger(result.fuelCost)).toBe(true);
        expect(Number.isInteger(result.netProfit)).toBe(true);
      });
    });

    describe('distance calculation', () => {
      it('uses haversine when roadDistanceKm not provided', () => {
        const result = computeOrderPricing(validInput, defaultRateCard);
        const expectedDistance = haversineKm(
          validInput.pickupLat, validInput.pickupLng,
          validInput.dropLat, validInput.dropLng
        );
        expect(result.distanceKm).toBeCloseTo(expectedDistance, 1);
      });

      it('uses provided roadDistanceKm when available', () => {
        const result = computeOrderPricing(
          { ...validInput, roadDistanceKm: 1500 },
          defaultRateCard
        );
        expect(result.distanceKm).toBe(1500);
      });

      it('falls back to haversine for invalid roadDistanceKm', () => {
        const result = computeOrderPricing(
          { ...validInput, roadDistanceKm: NaN },
          defaultRateCard
        );
        const expectedDistance = haversineKm(
          validInput.pickupLat, validInput.pickupLng,
          validInput.dropLat, validInput.dropLng
        );
        expect(result.distanceKm).toBeCloseTo(expectedDistance, 1);
      });

      it('falls back to haversine for negative roadDistanceKm', () => {
        const result = computeOrderPricing(
          { ...validInput, roadDistanceKm: -100 },
          defaultRateCard
        );
        const expectedDistance = haversineKm(
          validInput.pickupLat, validInput.pickupLng,
          validInput.dropLat, validInput.dropLng
        );
        expect(result.distanceKm).toBeCloseTo(expectedDistance, 1);
      });

      it('handles zero roadDistanceKm (uses haversine)', () => {
        // 0 is valid but means same location; haversine would also be ~0
        const result = computeOrderPricing(
          { ...validInput, roadDistanceKm: 0 },
          defaultRateCard
        );
        expect(result.distanceKm).toBe(0);
      });

      it('distanceKm is rounded to 2 decimal places', () => {
        const result = computeOrderPricing(validInput, defaultRateCard);
        const decimalPart = result.distanceKm.toString().split('.')[1] || '';
        expect(decimalPart.length).toBeLessThanOrEqual(2);
      });
    });

    describe('weight scaling', () => {
      it('baseFreight scales linearly with weight', () => {
        const light = computeOrderPricing({ ...validInput, weightTonnes: 5 }, defaultRateCard);
        const heavy = computeOrderPricing({ ...validInput, weightTonnes: 10 }, defaultRateCard);
        // Allow small rounding differences
        const ratio = heavy.baseFreight / light.baseFreight;
        expect(ratio).toBeCloseTo(2.0, 0);
      });

      it('higher weight produces higher totalAmount', () => {
        const light = computeOrderPricing({ ...validInput, weightTonnes: 5 }, defaultRateCard);
        const heavy = computeOrderPricing({ ...validInput, weightTonnes: 20 }, defaultRateCard);
        expect(heavy.totalAmount).toBeGreaterThan(light.totalAmount);
      });
    });

    describe('distance scaling', () => {
      it('baseFreight scales with distance', () => {
        const shortInput = { ...validInput, roadDistanceKm: 100 };
        const longInput = { ...validInput, roadDistanceKm: 500 };
        const short = computeOrderPricing(shortInput, defaultRateCard);
        const long = computeOrderPricing(longInput, defaultRateCard);
        expect(long.baseFreight).toBeGreaterThan(short.baseFreight);
      });

      it('tollEstimate scales with distance', () => {
        const shortInput = { ...validInput, roadDistanceKm: 100 };
        const longInput = { ...validInput, roadDistanceKm: 500 };
        const short = computeOrderPricing(shortInput, defaultRateCard);
        const long = computeOrderPricing(longInput, defaultRateCard);
        expect(long.tollEstimate).toBeGreaterThan(short.tollEstimate);
      });
    });

    describe('fragile cargo multiplier', () => {
      it('fragile cargo has higher baseFreight than non-fragile', () => {
        const normal = computeOrderPricing(validInput, defaultRateCard);
        const fragile = computeOrderPricing(
          { ...validInput, isFragile: true },
          defaultRateCard
        );
        expect(fragile.baseFreight).toBeGreaterThan(normal.baseFreight);
      });

      it('fragile multiplier is applied correctly (1.5x default)', () => {
        const normal = computeOrderPricing(validInput, defaultRateCard);
        const fragile = computeOrderPricing(
          { ...validInput, isFragile: true },
          defaultRateCard
        );
        // Fragile should be approximately 1.5x (accounting for handling fee)
        const ratio = fragile.baseFreight / normal.baseFreight;
        expect(ratio).toBeGreaterThan(1.3);
        expect(ratio).toBeLessThan(1.6);
      });

      it('fragile cargo has higher totalAmount', () => {
        const normal = computeOrderPricing(validInput, defaultRateCard);
        const fragile = computeOrderPricing(
          { ...validInput, isFragile: true },
          defaultRateCard
        );
        expect(fragile.totalAmount).toBeGreaterThan(normal.totalAmount);
      });
    });

    describe('stackable cargo discount', () => {
      it('stackable cargo has lower baseFreight than non-stackable', () => {
        const normal = computeOrderPricing(validInput, defaultRateCard);
        const stackable = computeOrderPricing(
          { ...validInput, isStackable: true },
          defaultRateCard
        );
        expect(stackable.baseFreight).toBeLessThan(normal.baseFreight);
      });

      it('stackable discount is applied correctly (0.9x default)', () => {
        const normal = computeOrderPricing(validInput, defaultRateCard);
        const stackable = computeOrderPricing(
          { ...validInput, isStackable: true },
          defaultRateCard
        );
        const ratio = stackable.baseFreight / normal.baseFreight;
        expect(ratio).toBeGreaterThan(0.85);
        expect(ratio).toBeLessThan(0.95);
      });
    });

    describe('combined cargo modifiers', () => {
      it('fragile AND stackable applies both modifiers', () => {
        const both = computeOrderPricing(
          { ...validInput, isFragile: true, isStackable: true },
          defaultRateCard
        );
        const onlyFragile = computeOrderPricing(
          { ...validInput, isFragile: true },
          defaultRateCard
        );
        // Stackable discount should reduce the fragile premium
        expect(both.baseFreight).toBeLessThan(onlyFragile.baseFreight);
      });

      it('modifiers are multiplicative', () => {
        const both = computeOrderPricing(
          { ...validInput, isFragile: true, isStackable: true },
          defaultRateCard
        );
        const normal = computeOrderPricing(validInput, defaultRateCard);
        // Expected: 1.5 * 0.9 = 1.35
        const ratio = both.baseFreight / normal.baseFreight;
        expect(ratio).toBeCloseTo(1.35, 0);
      });
    });

    describe('toll calculations', () => {
      it('toll is per-km multiplied by distance', () => {
        const input = { ...validInput, roadDistanceKm: 100 };
        const result = computeOrderPricing(input, defaultRateCard);
        const expectedToll = defaultRateCard.tollPerKm * 100;
        expect(result.tollEstimate).toBe(expectedToll);
      });

      it('tollFactor scales toll estimate', () => {
        const result1 = computeOrderPricing(
          { ...validInput, roadDistanceKm: 100, tollFactor: 1 },
          defaultRateCard
        );
        const result2 = computeOrderPricing(
          { ...validInput, roadDistanceKm: 100, tollFactor: 2 },
          defaultRateCard
        );
        expect(result2.tollEstimate).toBe(result1.tollEstimate * 2);
      });

      it('invalid tollFactor defaults to 1', () => {
        const result = computeOrderPricing(
          { ...validInput, roadDistanceKm: 100, tollFactor: NaN },
          defaultRateCard
        );
        const expectedToll = defaultRateCard.tollPerKm * 100;
        expect(result.tollEstimate).toBe(expectedToll);
      });

      it('negative tollFactor defaults to 1', () => {
        const result = computeOrderPricing(
          { ...validInput, roadDistanceKm: 100, tollFactor: -1 },
          defaultRateCard
        );
        const expectedToll = defaultRateCard.tollPerKm * 100;
        expect(result.tollEstimate).toBe(expectedToll);
      });

      it('zero tollFactor produces zero toll', () => {
        const result = computeOrderPricing(
          { ...validInput, roadDistanceKm: 100, tollFactor: 0 },
          defaultRateCard
        );
        expect(result.tollEstimate).toBe(0);
      });
    });

    describe('handling fee', () => {
      it('handling fee is added to baseFreight', () => {
        const input = { ...validInput, roadDistanceKm: 0, weightTonnes: 1 };
        const result = computeOrderPricing(input, defaultRateCard);
        // With 0 distance, base = handlingFee only
        expect(result.baseFreight).toBe(defaultRateCard.handlingFee);
      });

      it('zero handling fee works correctly', () => {
        const card = { ...defaultRateCard, handlingFee: 0 };
        const result = computeOrderPricing(validInput, card);
        expect(result.baseFreight).toBeGreaterThan(0);
      });
    });

    describe('platform fee percentage', () => {
      it('platform fee is within expected range (1-20%)', () => {
        const result = computeOrderPricing(validInput, defaultRateCard);
        const percentage = (result.platformFee / result.baseFreight) * 100;
        expect(percentage).toBeGreaterThanOrEqual(1);
        expect(percentage).toBeLessThanOrEqual(20);
      });

      it('custom platform fee percentage works', () => {
        const card = { ...defaultRateCard, platformFeePct: 10 };
        const result = computeOrderPricing(validInput, card);
        const expectedFee = Math.round((result.baseFreight * 10) / 100);
        expect(result.platformFee).toBe(expectedFee);
      });

      it('zero platform fee works correctly', () => {
        const card = { ...defaultRateCard, platformFeePct: 0 };
        const result = computeOrderPricing(validInput, card);
        expect(result.platformFee).toBe(0);
        expect(result.totalAmount).toBe(result.baseFreight + result.tollEstimate);
      });
    });

    describe('financial precision', () => {
      it('no floating point drift in totalAmount', () => {
        const result = computeOrderPricing(validInput, defaultRateCard);
        const manualSum = result.baseFreight + result.tollEstimate + result.platformFee;
        expect(result.totalAmount).toBe(manualSum);
        expect(Number.isInteger(result.totalAmount)).toBe(true);
      });

      it('handles fractional paisa correctly (rounds)', () => {
        // Create a scenario that would produce fractional paisa
        const card = { ...defaultRateCard, ratePerTonneKm: 33 }; // Odd number
        const result = computeOrderPricing(validInput, card);
        expect(Number.isInteger(result.baseFreight)).toBe(true);
      });

      it('netProfit never exceeds baseFreight', () => {
        const result = computeOrderPricing(validInput, defaultRateCard);
        expect(result.netProfit).toBeLessThanOrEqual(result.baseFreight);
      });

      it('netProfit is positive for normal scenarios', () => {
        const result = computeOrderPricing(validInput, defaultRateCard);
        expect(result.netProfit).toBeGreaterThan(0);
      });
    });

    describe('edge cases', () => {
      it('handles zero distance (same coordinates)', () => {
        const sameLocationInput = {
          pickupLat: 28.6139,
          pickupLng: 77.2090,
          dropLat: 28.6139,
          dropLng: 77.2090,
          weightTonnes: 10,
        };
        const result = computeOrderPricing(sameLocationInput, defaultRateCard);
        expect(result.distanceKm).toBe(0);
        expect(result.baseFreight).toBe(defaultRateCard.handlingFee);
        expect(result.tollEstimate).toBe(0);
      });

      it('handles very short distance (1 km)', () => {
        const input = { ...validInput, roadDistanceKm: 1 };
        const result = computeOrderPricing(input, defaultRateCard);
        expect(result.baseFreight).toBeGreaterThan(0);
        expect(result.totalAmount).toBeGreaterThan(0);
      });

      it('handles very long distance (2000 km)', () => {
        const input = { ...validInput, roadDistanceKm: 2000 };
        const result = computeOrderPricing(input, defaultRateCard);
        expect(result.baseFreight).toBeGreaterThan(1000000); // > ₹10,000
      });

      it('handles very light cargo (0.1 tonnes)', () => {
        const input = { ...validInput, weightTonnes: 0.1 };
        const result = computeOrderPricing(input, defaultRateCard);
        expect(result.baseFreight).toBeGreaterThan(0);
      });

      it('handles very heavy cargo (50 tonnes)', () => {
        const input = { ...validInput, weightTonnes: 50 };
        const result = computeOrderPricing(input, defaultRateCard);
        expect(result.baseFreight).toBeGreaterThan(0);
      });

      it('handles polar coordinates', () => {
        const input = {
          pickupLat: 89.9,
          pickupLng: 0,
          dropLat: -89.9,
          dropLng: 0,
          weightTonnes: 10,
        };
        const result = computeOrderPricing(input, defaultRateCard);
        expect(result.baseFreight).toBeGreaterThan(0);
        expect(Number.isFinite(result.totalAmount)).toBe(true);
      });
    });

    describe('rate card customization', () => {
      it('uses custom ratePerTonneKm', () => {
        const customCard = { ...defaultRateCard, ratePerTonneKm: 100 };
        const result = computeOrderPricing(validInput, customCard);
        const defaultResult = computeOrderPricing(validInput, defaultRateCard);
        // Custom rate is 2x default (100 vs 50)
        expect(result.baseFreight).toBeGreaterThan(defaultResult.baseFreight);
      });

      it('uses custom fragileMultiplier', () => {
        const customCard = { ...defaultRateCard, fragileMultiplier: 2.0 };
        const custom = computeOrderPricing(
          { ...validInput, isFragile: true },
          customCard
        );
        const normal = computeOrderPricing(validInput, customCard);
        const ratio = custom.baseFreight / normal.baseFreight;
        expect(ratio).toBeCloseTo(2.0, 0);
      });

      it('uses custom stackableDiscount', () => {
        const customCard = { ...defaultRateCard, stackableDiscount: 0.8 };
        const custom = computeOrderPricing(
          { ...validInput, isStackable: true },
          customCard
        );
        const normal = computeOrderPricing(validInput, customCard);
        const ratio = custom.baseFreight / normal.baseFreight;
        expect(ratio).toBeCloseTo(0.8, 1);
      });

      it('handles NaN in rate card gracefully', () => {
        const nanCard = { ...defaultRateCard, fragileMultiplier: NaN };
        const result = computeOrderPricing(
          { ...validInput, isFragile: true },
          nanCard
        );
        // Should not throw, should use 1 as fallback
        expect(Number.isFinite(result.baseFreight)).toBe(true);
      });
    });
  });

  // ── readRateCard (environment variable parsing) ───────────────────────────

  describe('readRateCard (environment variable parsing)', () => {
    it('uses defaults when env vars not set', () => {
      const card = readRateCard();
      expect(card.ratePerTonneKm).toBe(DEFAULTS.RATE_PER_TONNE_KM);
      expect(card.platformFeePct).toBe(DEFAULTS.PLATFORM_FEE_PCT);
    });

    it('parses TRUXIFY_RATE_PER_TONNE_KM from env', () => {
      process.env.TRUXIFY_RATE_PER_TONNE_KM = '75';
      const card = readRateCard();
      expect(card.ratePerTonneKm).toBe(75);
    });

    it('parses TRUXIFY_PLATFORM_FEE_PCT from env', () => {
      process.env.TRUXIFY_PLATFORM_FEE_PCT = '8';
      const card = readRateCard();
      expect(card.platformFeePct).toBe(8);
    });

    it('falls back to default for invalid env values', () => {
      process.env.TRUXIFY_RATE_PER_TONNE_KM = 'invalid';
      const card = readRateCard();
      expect(card.ratePerTonneKm).toBe(DEFAULTS.RATE_PER_TONNE_KM);
    });

    it('falls back to default for negative env values', () => {
      process.env.TRUXIFY_RATE_PER_TONNE_KM = '-10';
      const card = readRateCard();
      expect(card.ratePerTonneKm).toBe(DEFAULTS.RATE_PER_TONNE_KM);
    });

    it('handles empty string env values', () => {
      process.env.TRUXIFY_RATE_PER_TONNE_KM = '';
      const card = readRateCard();
      expect(card.ratePerTonneKm).toBe(DEFAULTS.RATE_PER_TONNE_KM);
    });

    it('parses float env values (TRUXIFY_FRAGILE_MULTIPLIER)', () => {
      process.env.TRUXIFY_FRAGILE_MULTIPLIER = '1.75';
      const card = readRateCard();
      expect(card.fragileMultiplier).toBe(1.75);
    });

    it('parses all rate card fields', () => {
      process.env.TRUXIFY_RATE_PER_TONNE_KM = '60';
      process.env.TRUXIFY_FRAGILE_MULTIPLIER = '1.6';
      process.env.TRUXIFY_STACKABLE_DISCOUNT = '0.85';
      process.env.TRUXIFY_HANDLING_FEE = '35000';
      process.env.TRUXIFY_PLATFORM_FEE_PCT = '6';
      process.env.TRUXIFY_FUEL_COST_PCT = '50';
      process.env.TRUXIFY_TOLL_PER_KM = '250';

      const card = readRateCard();
      expect(card.ratePerTonneKm).toBe(60);
      expect(card.fragileMultiplier).toBe(1.6);
      expect(card.stackableDiscount).toBe(0.85);
      expect(card.handlingFee).toBe(35000);
      expect(card.platformFeePct).toBe(6);
      expect(card.fuelCostPct).toBe(50);
      expect(card.tollPerKm).toBe(250);
    });
  });

  // ── Constants ─────────────────────────────────────────────────────────────

  describe('Constants', () => {
    it('EARTH_RADIUS_KM is reasonable (6300-6400 km)', () => {
      expect(EARTH_RADIUS_KM).toBeGreaterThan(6300);
      expect(EARTH_RADIUS_KM).toBeLessThan(6400);
    });

    it('DEFAULTS has all required fields', () => {
      expect(DEFAULTS).toHaveProperty('RATE_PER_TONNE_KM');
      expect(DEFAULTS).toHaveProperty('FRAGILE_MULTIPLIER');
      expect(DEFAULTS).toHaveProperty('STACKABLE_DISCOUNT');
      expect(DEFAULTS).toHaveProperty('HANDLING_FEE');
      expect(DEFAULTS).toHaveProperty('PLATFORM_FEE_PCT');
      expect(DEFAULTS).toHaveProperty('FUEL_COST_PCT');
      expect(DEFAULTS).toHaveProperty('TOLL_PER_KM');
    });

    it('DEFAULTS is frozen (immutable)', () => {
      expect(Object.isFrozen(DEFAULTS)).toBe(true);
    });

    it('DEFAULTS values are sensible', () => {
      expect(DEFAULTS.RATE_PER_TONNE_KM).toBeGreaterThan(0);
      expect(DEFAULTS.FRAGILE_MULTIPLIER).toBeGreaterThan(1);
      expect(DEFAULTS.STACKABLE_DISCOUNT).toBeLessThan(1);
      expect(DEFAULTS.STACKABLE_DISCOUNT).toBeGreaterThan(0);
      expect(DEFAULTS.HANDLING_FEE).toBeGreaterThanOrEqual(0);
      expect(DEFAULTS.PLATFORM_FEE_PCT).toBeGreaterThanOrEqual(0);
      expect(DEFAULTS.PLATFORM_FEE_PCT).toBeLessThan(100);
      expect(DEFAULTS.FUEL_COST_PCT).toBeGreaterThanOrEqual(0);
      expect(DEFAULTS.FUEL_COST_PCT).toBeLessThan(100);
      expect(DEFAULTS.TOLL_PER_KM).toBeGreaterThanOrEqual(0);
    });
  });
});
