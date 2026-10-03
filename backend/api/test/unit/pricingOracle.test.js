import { describe, it, expect } from 'vitest';
import { calculateFairMarketValue } from '../../src/services/pricingOracle.js';

describe('pricingOracle Service', () => {
  describe('Input validation and safety guards', () => {
    it('returns zero FMV when distanceMiles is 0 or non-positive', () => {
      const result = calculateFairMarketValue({ distanceMiles: 0, currentOfferedPayout: 500 });
      expect(result.loadDetails.distanceMiles).toBe(0);
      expect(result.oracleValuation.fairMarketValueUSD).toBe(0);
      expect(result.oracleValuation.fairRatePerMileUSD).toBe(0);
      expect(result.oracleValuation.recommendedCounterOfferUSD).toBe(0);
    });

    it('returns zero FMV when distanceMiles is negative', () => {
      const result = calculateFairMarketValue({ distanceMiles: -150 });
      expect(result.oracleValuation.fairMarketValueUSD).toBe(0);
    });

    it('returns zero FMV when distanceMiles is non-finite or missing', () => {
      expect(calculateFairMarketValue({ distanceMiles: NaN }).oracleValuation.fairMarketValueUSD).toBe(0);
      expect(calculateFairMarketValue({ distanceMiles: Infinity }).oracleValuation.fairMarketValueUSD).toBe(0);
      expect(calculateFairMarketValue({}).oracleValuation.fairMarketValueUSD).toBe(0);
      expect(calculateFairMarketValue()).toBeDefined();
    });

    it('handles non-finite truckToLoadRatio gracefully by defaulting to 1.0', () => {
      const result = calculateFairMarketValue(
        { distanceMiles: 100, currentOfferedPayout: 235 },
        { truckToLoadRatio: NaN }
      );
      expect(result.marketFactorsApplied.truckToLoadRatio).toBe(1.0);
      expect(result.marketFactorsApplied.capacityMultiplier).toBe(1.0);
    });

    it('handles non-finite localFuelPriceUSD gracefully by defaulting to national average (3.90)', () => {
      const result = calculateFairMarketValue(
        { distanceMiles: 100, currentOfferedPayout: 235 },
        { localFuelPriceUSD: NaN }
      );
      expect(result.marketFactorsApplied.localFuelPriceUSD).toBe(3.90);
      expect(result.marketFactorsApplied.fuelSurchargePerMileUSD).toBe(0);
    });
  });

  describe('Equipment type baseline rates', () => {
    const distance = 100;

    it('calculates FMV correctly for DRY_VAN ($2.35/mi baseline)', () => {
      const result = calculateFairMarketValue(
        { distanceMiles: distance, equipmentType: 'DRY_VAN', currentOfferedPayout: 235 },
        { truckToLoadRatio: 1.0, localFuelPriceUSD: 3.90 }
      );
      expect(result.oracleValuation.fairRatePerMileUSD).toBe(2.35);
      expect(result.oracleValuation.fairMarketValueUSD).toBe(235.00);
    });

    it('calculates FMV correctly for REEFER ($2.85/mi baseline)', () => {
      const result = calculateFairMarketValue(
        { distanceMiles: distance, equipmentType: 'REEFER', currentOfferedPayout: 285 },
        { truckToLoadRatio: 1.0, localFuelPriceUSD: 3.90 }
      );
      expect(result.oracleValuation.fairRatePerMileUSD).toBe(2.85);
      expect(result.oracleValuation.fairMarketValueUSD).toBe(285.00);
    });

    it('calculates FMV correctly for FLATBED ($2.95/mi baseline)', () => {
      const result = calculateFairMarketValue(
        { distanceMiles: distance, equipmentType: 'FLATBED', currentOfferedPayout: 295 },
        { truckToLoadRatio: 1.0, localFuelPriceUSD: 3.90 }
      );
      expect(result.oracleValuation.fairRatePerMileUSD).toBe(2.95);
      expect(result.oracleValuation.fairMarketValueUSD).toBe(295.00);
    });

    it('calculates FMV correctly for POWER_ONLY ($2.10/mi baseline)', () => {
      const result = calculateFairMarketValue(
        { distanceMiles: distance, equipmentType: 'POWER_ONLY', currentOfferedPayout: 210 },
        { truckToLoadRatio: 1.0, localFuelPriceUSD: 3.90 }
      );
      expect(result.oracleValuation.fairRatePerMileUSD).toBe(2.10);
      expect(result.oracleValuation.fairMarketValueUSD).toBe(210.00);
    });

    it('falls back to DRY_VAN baseline rate for unrecognized equipment types', () => {
      const result = calculateFairMarketValue(
        { distanceMiles: distance, equipmentType: 'UNKNOWN_TYPE', currentOfferedPayout: 200 },
        { truckToLoadRatio: 1.0, localFuelPriceUSD: 3.90 }
      );
      expect(result.oracleValuation.fairRatePerMileUSD).toBe(2.35);
      expect(result.oracleValuation.fairMarketValueUSD).toBe(235.00);
    });

    it('handles case-insensitive equipment type', () => {
      const result = calculateFairMarketValue(
        { distanceMiles: distance, equipmentType: 'reefer', currentOfferedPayout: 285 },
        { truckToLoadRatio: 1.0, localFuelPriceUSD: 3.90 }
      );
      expect(result.oracleValuation.fairRatePerMileUSD).toBe(2.85);
    });
  });

  describe('Capacity factor multipliers', () => {
    const distance = 100;

    it('applies 1.25x capacity multiplier for carrier market (ratio < 0.8)', () => {
      const result = calculateFairMarketValue(
        { distanceMiles: distance, equipmentType: 'DRY_VAN' },
        { truckToLoadRatio: 0.6, localFuelPriceUSD: 3.90 }
      );
      expect(result.marketFactorsApplied.capacityMultiplier).toBe(1.25);
      // 2.35 * 1.25 = 2.9375 => 2.94 / mile
      expect(result.oracleValuation.fairRatePerMileUSD).toBe(2.94);
      expect(result.oracleValuation.fairMarketValueUSD).toBe(293.75);
    });

    it('applies 1.12x capacity multiplier for tight capacity (0.8 <= ratio < 1.0)', () => {
      const result = calculateFairMarketValue(
        { distanceMiles: distance, equipmentType: 'DRY_VAN' },
        { truckToLoadRatio: 0.9, localFuelPriceUSD: 3.90 }
      );
      expect(result.marketFactorsApplied.capacityMultiplier).toBe(1.12);
      // 2.35 * 1.12 = 2.632 => 2.63 / mile
      expect(result.oracleValuation.fairRatePerMileUSD).toBe(2.63);
      expect(result.oracleValuation.fairMarketValueUSD).toBe(263.20);
    });

    it('applies 1.0x capacity multiplier for balanced market (1.0 <= ratio <= 1.5)', () => {
      const result = calculateFairMarketValue(
        { distanceMiles: distance, equipmentType: 'DRY_VAN' },
        { truckToLoadRatio: 1.2, localFuelPriceUSD: 3.90 }
      );
      expect(result.marketFactorsApplied.capacityMultiplier).toBe(1.0);
    });

    it('applies 0.90x capacity multiplier for loose capacity (ratio > 1.5)', () => {
      const result = calculateFairMarketValue(
        { distanceMiles: distance, equipmentType: 'DRY_VAN' },
        { truckToLoadRatio: 1.8, localFuelPriceUSD: 3.90 }
      );
      expect(result.marketFactorsApplied.capacityMultiplier).toBe(0.90);
      // 2.35 * 0.90 = 2.115 => 2.12 / mile
      expect(result.oracleValuation.fairRatePerMileUSD).toBe(2.12);
      expect(result.oracleValuation.fairMarketValueUSD).toBe(211.50);
    });
  });

  describe('Fuel surcharge calculation', () => {
    const distance = 100;

    it('adds fuel surcharge when local price exceeds national baseline ($3.90)', () => {
      // localFuelPrice = 4.55, delta = 0.65, 0.65 / 6.5 = 0.10 / mile
      const result = calculateFairMarketValue(
        { distanceMiles: distance, equipmentType: 'DRY_VAN' },
        { truckToLoadRatio: 1.0, localFuelPriceUSD: 4.55 }
      );
      expect(result.marketFactorsApplied.fuelSurchargePerMileUSD).toBe(0.10);
      expect(result.oracleValuation.fairRatePerMileUSD).toBe(2.45);
      expect(result.oracleValuation.fairMarketValueUSD).toBe(245.00);
    });

    it('does not apply negative fuel surcharge when local price is below national baseline', () => {
      const result = calculateFairMarketValue(
        { distanceMiles: distance, equipmentType: 'DRY_VAN' },
        { truckToLoadRatio: 1.0, localFuelPriceUSD: 3.50 }
      );
      expect(result.marketFactorsApplied.fuelSurchargePerMileUSD).toBe(0);
      expect(result.oracleValuation.fairRatePerMileUSD).toBe(2.35);
      expect(result.oracleValuation.fairMarketValueUSD).toBe(235.00);
    });
  });

  describe('Market gauge and counter-offer strategy', () => {
    const distance = 100;
    // Base FMV for DRY_VAN, 100 miles, neutral conditions = $235

    it('classifies as BELOW_MARKET when payout < 90% of FMV and adds 5% negotiation cushion', () => {
      // 235 * 0.9 = 211.5, offered payout = 200
      const result = calculateFairMarketValue(
        { distanceMiles: distance, equipmentType: 'DRY_VAN', currentOfferedPayout: 200 },
        { truckToLoadRatio: 1.0, localFuelPriceUSD: 3.90 }
      );
      expect(result.oracleValuation.marketGauge).toBe('BELOW_MARKET');
      // Counter-offer = ceil(235 * 1.05) = ceil(246.75) = 247
      expect(result.oracleValuation.recommendedCounterOfferUSD).toBe(247);
      expect(result.oracleValuation.potentialGainUSD).toBe(35.00);
    });

    it('classifies as FAIR when payout is between 90% and 110% of FMV', () => {
      const result = calculateFairMarketValue(
        { distanceMiles: distance, equipmentType: 'DRY_VAN', currentOfferedPayout: 235 },
        { truckToLoadRatio: 1.0, localFuelPriceUSD: 3.90 }
      );
      expect(result.oracleValuation.marketGauge).toBe('FAIR');
      expect(result.oracleValuation.potentialGainUSD).toBe(0);
    });

    it('classifies as ABOVE_MARKET when payout > 110% of FMV', () => {
      // 235 * 1.1 = 258.5, offered payout = 280
      const result = calculateFairMarketValue(
        { distanceMiles: distance, equipmentType: 'DRY_VAN', currentOfferedPayout: 280 },
        { truckToLoadRatio: 1.0, localFuelPriceUSD: 3.90 }
      );
      expect(result.oracleValuation.marketGauge).toBe('ABOVE_MARKET');
      expect(result.oracleValuation.recommendedCounterOfferUSD).toBe(280);
      expect(result.oracleValuation.potentialGainUSD).toBe(0);
    });
  });
});
