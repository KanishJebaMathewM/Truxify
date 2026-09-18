import { describe, it, expect } from 'vitest';
import { generateIftaReport } from '../../src/services/iftaTax.js';

describe('iftaTax service', () => {
  it('generates an empty report with default values when no waypoints or fuel purchases provided', () => {
    const report = generateIftaReport({
      truckId: 'TRK-900',
      quarter: 'Q1',
      year: 2026
    });

    expect(report.truckId).toBe('TRK-900');
    expect(report.period).toBe('Q1 2026');
    expect(report.summary.totalMilesDriven).toBe(0);
    expect(report.summary.totalGallonsPurchased).toBe(0);
    expect(report.summary.fleetAverageMpg).toBe(6.5);
    expect(report.jurisdictionBreakdown).toEqual([]);
    expect(report.generatedAt).toBeDefined();
  });

  it('calculates mileage and aggregates fuel purchases across jurisdictions', () => {
    // Coordinate waypoints: New York to Pennsylvania
    const waypoints = [
      { latitude: 40.7128, longitude: -74.0060, jurisdictionState: 'NY' },
      { latitude: 40.5000, longitude: -74.5000, jurisdictionState: 'NY' },
      { latitude: 40.2732, longitude: -76.8867, jurisdictionState: 'PA' }
    ];

    const fuelPurchases = [
      { jurisdictionState: 'NY', gallons: 50, taxPaidUSD: 24.5 },
      { jurisdictionState: 'PA', gallons: 70, taxPaidUSD: 38.5 }
    ];

    const report = generateIftaReport({
      truckId: 'TRK-901',
      quarter: 'Q2',
      year: 2026,
      waypoints,
      fuelPurchases
    });

    expect(report.truckId).toBe('TRK-901');
    expect(report.period).toBe('Q2 2026');
    expect(report.summary.totalMilesDriven).toBeGreaterThan(100);
    expect(report.summary.totalGallonsPurchased).toBe(120);
    expect(report.summary.fleetAverageMpg).toBeGreaterThan(0);

    const ny = report.jurisdictionBreakdown.find(b => b.jurisdictionState === 'NY');
    expect(ny).toBeDefined();
    expect(ny.totalMilesDriven).toBeGreaterThan(0);
    expect(ny.taxableGallonsPurchased).toBe(50);
    expect(ny.taxPaidUSD).toBe(24.5);

    const pa = report.jurisdictionBreakdown.find(b => b.jurisdictionState === 'PA');
    expect(pa).toBeDefined();
    expect(pa.totalMilesDriven).toBeGreaterThan(0);
    expect(pa.taxableGallonsPurchased).toBe(70);
    expect(pa.taxPaidUSD).toBe(38.5);
  });

  it('handles unknown jurisdiction when jurisdictionState is missing', () => {
    const waypoints = [
      { latitude: 34.0522, longitude: -118.2437 },
      { latitude: 34.1000, longitude: -118.3000 }
    ];

    const fuelPurchases = [
      { gallons: 20, taxPaidUSD: 10 }
    ];

    const report = generateIftaReport({
      truckId: 'TRK-902',
      waypoints,
      fuelPurchases
    });

    const unknown = report.jurisdictionBreakdown.find(b => b.jurisdictionState === 'UNKNOWN');
    expect(unknown).toBeDefined();
    expect(unknown.totalMilesDriven).toBeGreaterThan(0);
    expect(unknown.taxableGallonsPurchased).toBe(20);
    expect(unknown.taxPaidUSD).toBe(10);
  });
});
