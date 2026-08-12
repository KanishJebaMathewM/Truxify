import { describe, it, expect } from 'vitest';
import { calculateEarningsAggregation } from '../../src/services/driverEarningsService.js';

describe('driverEarningsService.calculateEarningsAggregation', () => {
  it('aggregates numeric trip earnings', () => {
    const trips = [
      { total_earnings: 1000, net_earnings: 900 },
      { total_earnings: 2000, net_earnings: 1800 },
    ];

    const result = calculateEarningsAggregation(trips);

    expect(result.gross_earnings).toBe(3000);
    expect(result.net_earnings).toBe(2700);
    expect(result.trips_completed).toBe(2);
  });

  it('treats null or undefined earnings as 0', () => {
    const trips = [
      { total_earnings: null, net_earnings: undefined },
      { total_earnings: 1500, net_earnings: null },
    ];

    const result = calculateEarningsAggregation(trips);

    expect(result.gross_earnings).toBe(1500);
    expect(result.net_earnings).toBe(0);
    expect(result.trips_completed).toBe(2);
  });

  it('replaces NaN earnings values with 0', () => {
    const trips = [
      { total_earnings: NaN, net_earnings: 500 },
      { total_earnings: 1000, net_earnings: Number('invalid') },
    ];

    const result = calculateEarningsAggregation(trips);

    expect(result.gross_earnings).toBe(1000);
    expect(result.net_earnings).toBe(500);
  });

  it('never returns NaN totals for Infinity inputs', () => {
    const trips = [
      { total_earnings: Infinity, net_earnings: -Infinity },
      { total_earnings: 500, net_earnings: 400 },
    ];

    const result = calculateEarningsAggregation(trips);

    expect(Number.isNaN(result.gross_earnings)).toBe(false);
    expect(Number.isNaN(result.net_earnings)).toBe(false);
  });

  it('returns zeros for an empty trip list', () => {
    const result = calculateEarningsAggregation([]);

    expect(result.gross_earnings).toBe(0);
    expect(result.net_earnings).toBe(0);
    expect(result.trips_completed).toBe(0);
  });

  it('builds a 7-day weekly chart frame', () => {
    const result = calculateEarningsAggregation([], [], null);
    expect(result.weekly_chart).toHaveLength(7);
    expect(result.weekly_chart.every((d) => d.earnings === 0)).toBe(true);
  });

  it('accumulates total distance from text distance values', () => {
    const trips = [
      { total_earnings: 100, net_earnings: 80, distance: '100 km' },
      { total_earnings: 100, net_earnings: 80, distance: '50.5 km' },
    ];
    const result = calculateEarningsAggregation(trips, [], null);
    expect(result.cumulative_stats.total_km).toBeCloseTo(150.5);
    expect(result.cumulative_stats.lifetime_trips).toBeNull();
  });
});
