/**
 * Unit coverage for the driver earnings summary aggregation.
 *
 * The router previously returned a hardcoded `mockTrips` array attributed to
 * a `demo-driver` placeholder. These tests pin the real aggregation, with
 * particular attention to the nullable monetary columns — `total_earnings`
 * and `fuel_deducted` are both nullable in the schema, and a null propagating
 * into the reduce turns an entire summary into NaN.
 */
import { describe, expect, it } from 'vitest';
import {
  buildEarningsSummary,
  getPeriodStart,
} from '../../src/services/driver/earningsSummaryService.js';

const DRIVER = '22222222-2222-2222-2222-222222222222';

function trip(overrides = {}) {
  return {
    trip_display_id: 'TRP-001',
    trip_date: '2026-08-01',
    distance: '420 km',
    total_earnings: 12000,
    fuel_deducted: 2000,
    ...overrides,
  };
}

describe('getPeriodStart', () => {
  it('returns seven days back for the weekly window', () => {
    const start = getPeriodStart('weekly');
    const diffDays = Math.round((Date.now() - start.getTime()) / 86_400_000);
    expect(diffDays).toBe(7);
  });

  it('returns the first of the current month for the monthly window', () => {
    const start = getPeriodStart('monthly');
    expect(start.getDate()).toBe(1);
    expect(start.getMonth()).toBe(new Date().getMonth());
  });

  it('defaults to the monthly window for an unrecognised period', () => {
    // Validation rejects these before the handler runs; this is defence in depth.
    expect(getPeriodStart(undefined).getDate()).toBe(1);
    expect(getPeriodStart('yearly').getDate()).toBe(1);
  });
});

describe('buildEarningsSummary', () => {
  it('aggregates gross, deductions and net across trips', () => {
    const summary = buildEarningsSummary(
      [
        trip({ total_earnings: 12000, fuel_deducted: 2000 }),
        trip({ trip_display_id: 'TRP-002', total_earnings: 9500, fuel_deducted: 1800 }),
      ],
      'monthly',
      DRIVER
    );

    expect(summary.totalGross).toBe(21500);
    expect(summary.totalDeductions).toBe(3800);
    expect(summary.netEarnings).toBe(17700);
    expect(summary.tripCount).toBe(2);
  });

  it('attributes the summary to the authenticated driver', () => {
    const summary = buildEarningsSummary([trip()], 'monthly', DRIVER);
    expect(summary.driverId).toBe(DRIVER);
    // The placeholder identity the endpoint used to fall back to.
    expect(summary.driverId).not.toBe('demo-driver');
  });

  it('returns a zeroed summary for a driver with no trips', () => {
    const summary = buildEarningsSummary([], 'weekly', DRIVER);

    expect(summary.totalGross).toBe(0);
    expect(summary.totalDeductions).toBe(0);
    expect(summary.netEarnings).toBe(0);
    expect(summary.tripCount).toBe(0);
    expect(summary.trips).toEqual([]);
  });

  it('treats a null total_earnings as zero rather than producing NaN', () => {
    const summary = buildEarningsSummary(
      [trip({ total_earnings: null }), trip({ total_earnings: 5000, fuel_deducted: 500 })],
      'monthly',
      DRIVER
    );

    expect(summary.totalGross).toBe(5000);
    expect(Number.isNaN(summary.netEarnings)).toBe(false);
  });

  it('treats a null fuel_deducted as zero', () => {
    const summary = buildEarningsSummary(
      [trip({ total_earnings: 8000, fuel_deducted: null })],
      'monthly',
      DRIVER
    );

    expect(summary.totalDeductions).toBe(0);
    expect(summary.netEarnings).toBe(8000);
  });

  it('ignores non-numeric monetary values instead of corrupting the total', () => {
    const summary = buildEarningsSummary(
      [trip({ total_earnings: 'not-a-number', fuel_deducted: undefined })],
      'monthly',
      DRIVER
    );

    expect(summary.totalGross).toBe(0);
    expect(summary.totalDeductions).toBe(0);
  });

  it('handles a null or non-array trips argument', () => {
    expect(buildEarningsSummary(null, 'monthly', DRIVER).tripCount).toBe(0);
    expect(buildEarningsSummary(undefined, 'monthly', DRIVER).tripCount).toBe(0);
  });

  it('computes per-trip net from that trip alone', () => {
    const summary = buildEarningsSummary(
      [trip({ total_earnings: 12000, fuel_deducted: 2300 })],
      'monthly',
      DRIVER
    );

    expect(summary.trips[0]).toMatchObject({
      id: 'TRP-001',
      gross: 12000,
      deductions: 2300,
      net: 9700,
    });
  });

  it('reports broker savings against gross', () => {
    const summary = buildEarningsSummary(
      [trip({ total_earnings: 10000, fuel_deducted: 0 })],
      'monthly',
      DRIVER
    );

    expect(summary.brokerSavingsPercent).toBe(35);
    expect(summary.brokerSavingsAmount).toBe(3500);
  });

  it('reports zero broker savings when there is no gross', () => {
    const summary = buildEarningsSummary([], 'monthly', DRIVER);
    expect(summary.brokerSavingsAmount).toBe(0);
    // Percentage is a constant rate, so it stays meaningful at zero gross.
    expect(summary.brokerSavingsPercent).toBe(35);
  });

  it('echoes the requested period back to the client', () => {
    expect(buildEarningsSummary([], 'weekly', DRIVER).period).toBe('weekly');
    expect(buildEarningsSummary([], 'monthly', DRIVER).period).toBe('monthly');
  });

  it('does not return fabricated placeholder trips', () => {
    const summary = buildEarningsSummary([], 'monthly', DRIVER);
    const ids = summary.trips.map((t) => t.id);
    expect(ids).not.toContain('trip_001');
    expect(ids).not.toContain('trip_002');
  });
});
