import { describe, it, expect, beforeEach } from 'vitest';
import carbonService from '../../../src/services/carbonService.js';

describe('CarbonService - Scope 3 Emissions & Green Tokenization (#16430)', () => {
  beforeEach(() => {});

  it('should calculate emissions accurately for BS-VI diesel trucks', () => {
    const result = carbonService.calculateEmissions({
      fuelClass: 'BS-VI',
      distanceKm: 200,
      payloadTons: 10,
    });

    // 200 km * 10 tons * 50.0 g/ton-km = 100,000g = 100 kg CO2e
    expect(result.totalKgCO2e).toBe(100.0);
    expect(result.isGreenEligible).toBe(false);
  });

  it('should calculate lower emissions and flag green eligibility for EVs', () => {
    const result = carbonService.calculateEmissions({
      fuelClass: 'EV',
      distanceKm: 100,
      payloadTons: 5,
      gradientFactor: 1.2,
    });

    // 100 * 5 * 10.5 * 1.2 = 6300g = 6.3 kg CO2e
    expect(result.totalKgCO2e).toBe(6.3);
    expect(result.isGreenEligible).toBe(true);
  });

  it('should throw an error for unsupported fuel classes', () => {
    expect(() =>
      carbonService.calculateEmissions({
        fuelClass: 'INVALID_FUEL',
        distanceKm: 100,
        payloadTons: 5,
      })
    ).toThrow(/invalid or unsupported vehicle fuel class/i);
  });

  it('should process green freight certification and award driver XP for electric vehicles', async () => {
    const rewards = await carbonService.processGreenFreightRewards({
      tripId: 'trip-999',
      fuelClass: 'EV',
      distanceKm: 150,
      payloadTons: 8,
    });

    expect(rewards.certified).toBe(true);
    expect(rewards.tokenStandard).toBe('ERC-1155');
    expect(rewards.network).toBe('Polygon');
    expect(rewards.xpAwarded).toBe(250);
  });
});
