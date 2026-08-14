import { describe, it, expect } from 'vitest';
import { calculateEarningsAggregation } from '../../../src/services/driverEarningsService.js';

describe('calculateEarningsAggregation', () => {
  it('returns zeroed structure when trips is empty', () => {
    const result = calculateEarningsAggregation([], [], null);
    expect(result.gross_earnings).toBe(0);
    expect(result.net_earnings).toBe(0);
    expect(result.trips_completed).toBe(0);
    expect(result.weekly_chart).toHaveLength(7);
    expect(result.deadhead_trips_saved).toBe(0);
  });

  it('returns zeroed structure when trips is null', () => {
    const result = calculateEarningsAggregation(null, null, null);
    expect(result.gross_earnings).toBe(0);
    expect(result.trips_completed).toBe(0);
  });

  it('aggregates total_earnings and net_earnings', () => {
    const trips = [
      { total_earnings: 1000, net_earnings: 800, distance: '100', trip_date: new Date().toISOString() },
      { total_earnings: 2000, net_earnings: 1500, distance: '150', trip_date: new Date().toISOString() },
    ];
    const result = calculateEarningsAggregation(trips, trips, 10);
    expect(result.gross_earnings).toBe(3000);
    expect(result.net_earnings).toBe(2300);
    expect(result.trips_completed).toBe(2);
  });

  it('treats NaN earnings as zero', () => {
    const trips = [
      { total_earnings: 'not-a-number', net_earnings: 'invalid', distance: '0', trip_date: null },
    ];
    const result = calculateEarningsAggregation(trips, trips, 1);
    expect(result.gross_earnings).toBe(0);
    expect(result.net_earnings).toBe(0);
  });

  it('parses string distance values', () => {
    const trips = [
      { total_earnings: 500, net_earnings: 400, distance: '123.45', trip_date: null },
    ];
    const result = calculateEarningsAggregation(trips, trips, 1);
    expect(result.cumulative_stats.total_km).toBeCloseTo(123.45, 1);
  });

  it('handles non-numeric distance gracefully', () => {
    const trips = [
      { total_earnings: 500, net_earnings: 400, distance: 'abc', trip_date: null },
    ];
    const result = calculateEarningsAggregation(trips, trips, 1);
    expect(result.cumulative_stats.total_km).toBe(0);
  });

  it('calculates avg_earning_per_km', () => {
    const trips = [
      { total_earnings: 2000, net_earnings: 1000, distance: '100', trip_date: null },
    ];
    const result = calculateEarningsAggregation(trips, trips, 1);
    // avg = (net_earnings / 100) / total_km = 1000 / 100 / 100 = 0.1
    expect(result.cumulative_stats.avg_earning_per_km).toBe(0.1);
  });

  it('returns zero avg when total_km is zero', () => {
    const trips = [
      { total_earnings: 1000, net_earnings: 800, distance: '0', trip_date: null },
    ];
    const result = calculateEarningsAggregation(trips, trips, 1);
    expect(result.cumulative_stats.avg_earning_per_km).toBe(0);
  });

  it('populates weekly_chart with 7 days', () => {
    const result = calculateEarningsAggregation([], [], null);
    expect(result.weekly_chart).toHaveLength(7);
    expect(result.weekly_chart.every(d => d.earnings === 0)).toBe(true);
  });

  it('increments deadhead_trips_saved for consecutive matching trips', () => {
    const pastDate = new Date(Date.now() - 86400000).toISOString(); // 1 day ago
    const trips = [
      { trip_date: pastDate, route_label: 'A → B' },
    ];
    const allTrips = [
      { trip_date: new Date(Date.now() - 2 * 86400000).toISOString(), route_label: 'X → A' },
      { trip_date: pastDate, route_label: 'A → B' },
    ];
    const result = calculateEarningsAggregation(trips, allTrips, 2);
    expect(result.deadhead_trips_saved).toBe(1);
  });

  it('does not count deadhead when drop does not match next pickup', () => {
    const trips = [
      { trip_date: new Date().toISOString(), route_label: 'A → B' },
    ];
    const allTrips = [
      { trip_date: new Date(Date.now() - 2 * 86400000).toISOString(), route_label: 'X → C' },
      { trip_date: new Date().toISOString(), route_label: 'A → B' },
    ];
    const result = calculateEarningsAggregation(trips, allTrips, 2);
    expect(result.deadhead_trips_saved).toBe(0);
  });

  it('handles null/undefined route_label', () => {
    const allTrips = [
      { trip_date: new Date().toISOString(), route_label: null },
      { trip_date: new Date().toISOString(), route_label: undefined },
    ];
    const result = calculateEarningsAggregation([], allTrips, 2);
    expect(result.deadhead_trips_saved).toBe(0);
  });

  it('passes lifetime_trips to result', () => {
    const result = calculateEarningsAggregation([], [], 42);
    expect(result.cumulative_stats.lifetime_trips).toBe(42);
  });

  it('passes null lifetime_trips when not provided', () => {
    const result = calculateEarningsAggregation([], [], null);
    expect(result.cumulative_stats.lifetime_trips).toBeNull();
  });
});
