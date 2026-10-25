import { describe, it, expect } from 'vitest';
import {
  estimateTripProfit,
  toFinitePositive,
  DEFAULT_PROFIT_CONFIG,
} from '../../src/services/tripProfitEstimator.js';

describe('toFinitePositive', () => {
  it('returns the numeric value for a valid positive number', () => {
    expect(toFinitePositive(400)).toBe(400);
  });

  it('returns 0 for null', () => {
    expect(toFinitePositive(null)).toBe(0);
  });

  it('returns 0 for undefined', () => {
    expect(toFinitePositive(undefined)).toBe(0);
  });

  it('returns 0 for NaN', () => {
    expect(toFinitePositive(NaN)).toBe(0);
  });

  it('returns 0 for Infinity', () => {
    expect(toFinitePositive(Infinity)).toBe(0);
  });

  it('returns 0 for a negative number', () => {
    expect(toFinitePositive(-10)).toBe(0);
  });

  it('returns 0 for a non-numeric string', () => {
    expect(toFinitePositive('abc')).toBe(0);
  });

  it('coerces a numeric string', () => {
    expect(toFinitePositive('250')).toBe(250);
  });

  it('uses the custom fallback for non-finite values', () => {
    expect(toFinitePositive(NaN, 99)).toBe(99);
  });
});

describe('estimateTripProfit — canonical example from the spec', () => {
  // Spec example:
  //   Freight: ₹18,000 | Fuel: ₹7,200 | Tolls: ₹1,200 | Other: ₹600
  //   Net profit: ₹9,000 | Profit/km: ₹22.50
  //
  // Back-calculation:
  //   distance = 400 km
  //   fuelPricePerLitre = 90, truckKmPerLitre = 5  → 400/5 * 90 = 7200
  //   tollRatePerKm     = 3                         → 400 * 3    = 1200
  //   otherCostPerKm    = 1.5                       → 400 * 1.5  =  600
  const result = estimateTripProfit({
    freightAmountInr: 18000,
    distanceKm: 400,
    config: {
      fuelPricePerLitre: 90,
      truckKmPerLitre: 5,
      tollRatePerKm: 3,
      otherCostPerKm: 1.5,
    },
  });

  it('always sets isEstimate to true', () => {
    expect(result.isEstimate).toBe(true);
  });

  it('returns the correct freight amount', () => {
    expect(result.freightAmount).toBe(18000);
  });

  it('returns the correct estimated fuel cost', () => {
    expect(result.estimatedFuelCost).toBe(7200);
  });

  it('returns the correct estimated toll cost', () => {
    expect(result.estimatedTollCost).toBe(1200);
  });

  it('returns the correct other costs', () => {
    expect(result.otherCosts).toBe(600);
  });

  it('returns the correct net profit', () => {
    expect(result.estimatedNetProfit).toBe(9000);
  });

  it('returns the correct profit per km', () => {
    expect(result.profitPerKm).toBe(22.5);
  });

  it('returns the correct distance', () => {
    expect(result.distanceKm).toBe(400);
  });
});

describe('estimateTripProfit — default config', () => {
  it('uses DEFAULT_PROFIT_CONFIG when no config is provided', () => {
    const result = estimateTripProfit({
      freightAmountInr: 20000,
      distanceKm: 500,
    });

    const { fuelPricePerLitre, truckKmPerLitre, tollRatePerKm, otherCostPerKm } = DEFAULT_PROFIT_CONFIG;
    const expectedFuel  = (500 / truckKmPerLitre) * fuelPricePerLitre;
    const expectedToll  = 500 * tollRatePerKm;
    const expectedOther = 500 * otherCostPerKm;
    const expectedNet   = 20000 - expectedFuel - expectedToll - expectedOther;

    expect(result.estimatedFuelCost).toBeCloseTo(expectedFuel, 2);
    expect(result.estimatedTollCost).toBeCloseTo(expectedToll, 2);
    expect(result.otherCosts).toBeCloseTo(expectedOther, 2);
    expect(result.estimatedNetProfit).toBeCloseTo(expectedNet, 2);
  });
});

describe('estimateTripProfit — graceful degradation', () => {
  it('does not throw when called with no arguments', () => {
    expect(() => estimateTripProfit()).not.toThrow();
  });

  it('returns zero profit when freight is 0', () => {
    const result = estimateTripProfit({ freightAmountInr: 0, distanceKm: 100 });
    expect(result.freightAmount).toBe(0);
    expect(result.estimatedNetProfit).toBeLessThanOrEqual(0);
  });

  it('returns zero costs when distance is 0', () => {
    const result = estimateTripProfit({ freightAmountInr: 5000, distanceKm: 0 });
    expect(result.estimatedFuelCost).toBe(0);
    expect(result.estimatedTollCost).toBe(0);
    expect(result.otherCosts).toBe(0);
    expect(result.estimatedNetProfit).toBe(5000);
    expect(result.profitPerKm).toBe(0);
  });

  it('does not crash when freight is null', () => {
    const result = estimateTripProfit({ freightAmountInr: null, distanceKm: 200 });
    expect(result.freightAmount).toBe(0);
    expect(result.isEstimate).toBe(true);
  });

  it('does not crash when distanceKm is undefined', () => {
    const result = estimateTripProfit({ freightAmountInr: 10000 });
    expect(result.distanceKm).toBe(0);
    expect(result.isEstimate).toBe(true);
  });

  it('falls back to default mileage when truckKmPerLitre is 0 (no division by zero)', () => {
    expect(() =>
      estimateTripProfit({
        freightAmountInr: 10000,
        distanceKm: 300,
        config: { truckKmPerLitre: 0 },
      })
    ).not.toThrow();
  });

  it('ignores invalid config values and falls back to defaults', () => {
    const result = estimateTripProfit({
      freightAmountInr: 10000,
      distanceKm: 200,
      config: {
        fuelPricePerLitre: NaN,
        truckKmPerLitre: -5,
        tollRatePerKm: null,
        otherCostPerKm: undefined,
      },
    });
    expect(result.isEstimate).toBe(true);
  });

  it('returns a negative net profit when expenses exceed freight', () => {
    const result = estimateTripProfit({
      freightAmountInr: 100,
      distanceKm: 1000,
    });
    expect(result.estimatedNetProfit).toBeLessThan(0);
    expect(result.isEstimate).toBe(true);
  });
});

describe('estimateTripProfit — partial config override', () => {
  it('only overrides the provided config keys', () => {
    const resultOverride = estimateTripProfit({
      freightAmountInr: 15000,
      distanceKm: 300,
      config: { fuelPricePerLitre: 100 },
    });

    const resultDefault = estimateTripProfit({
      freightAmountInr: 15000,
      distanceKm: 300,
    });

    const expectedFuelOverride = (300 / DEFAULT_PROFIT_CONFIG.truckKmPerLitre) * 100;
    expect(resultOverride.estimatedFuelCost).toBeCloseTo(expectedFuelOverride, 2);
    expect(resultOverride.estimatedTollCost).toBe(resultDefault.estimatedTollCost);
    expect(resultOverride.otherCosts).toBe(resultDefault.otherCosts);
  });
});
