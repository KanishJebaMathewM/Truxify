import { describe, it, expect } from 'vitest';
import driverEarningsService, {
  toAmount,
  calculateAverageEarnings,
  calculateCompletionRate,
  aggregateTripEarnings,
  calculateEarningsAggregation,
} from '../../../src/services/driverEarningsService.js';

describe('services/driverEarningsService.js Unit Tests', () => {
  describe('toAmount', () => {
    it('returns numeric value when finite', () => {
      expect(toAmount(100)).toBe(100);
      expect(toAmount(0)).toBe(0);
      expect(toAmount(-50)).toBe(-50);
      expect(toAmount('150.5')).toBe(150.5);
      expect(toAmount('0')).toBe(0);
      expect(toAmount('-25.75')).toBe(-25.75);
    });

    it('returns 0 for non-finite, null, or undefined values', () => {
      expect(toAmount(null)).toBe(0);
      expect(toAmount(undefined)).toBe(0);
      expect(toAmount(NaN)).toBe(0);
      expect(toAmount(Infinity)).toBe(0);
      expect(toAmount(-Infinity)).toBe(0);
      expect(toAmount('invalid')).toBe(0);
      expect(toAmount('')).toBe(0);
      expect(toAmount({})).toBe(0);
      expect(toAmount([])).toBe(0);
      expect(toAmount(true)).toBe(1); // Number(true) is 1, which is finite
      expect(toAmount(false)).toBe(0);
    });
  });

  describe('calculateAverageEarnings', () => {
    it('calculates average correctly for positive finite count', () => {
      expect(calculateAverageEarnings(1000, 4)).toBe(250);
      expect(calculateAverageEarnings(300, 2)).toBe(150);
      expect(calculateAverageEarnings(0, 5)).toBe(0);
    });

    it('returns 0 when count is zero, negative, or not finite', () => {
      expect(calculateAverageEarnings(1000, 0)).toBe(0);
      expect(calculateAverageEarnings(1000, -1)).toBe(0);
      expect(calculateAverageEarnings(1000, NaN)).toBe(0);
      expect(calculateAverageEarnings(1000, Infinity)).toBe(0);
      expect(calculateAverageEarnings(1000, null)).toBe(0);
      expect(calculateAverageEarnings(1000, undefined)).toBe(0);
    });

    it('returns 0 when totalEarnings is not finite', () => {
      expect(calculateAverageEarnings(NaN, 5)).toBe(0);
      expect(calculateAverageEarnings(Infinity, 5)).toBe(0);
      expect(calculateAverageEarnings(-Infinity, 5)).toBe(0);
      expect(calculateAverageEarnings(null, 5)).toBe(0);
      expect(calculateAverageEarnings(undefined, 5)).toBe(0);
    });
  });

  describe('calculateCompletionRate', () => {
    it('calculates completion rate correctly for positive finite totalTrips', () => {
      expect(calculateCompletionRate(8, 10)).toBe(0.8);
      expect(calculateCompletionRate(0, 10)).toBe(0);
      expect(calculateCompletionRate(10, 10)).toBe(1);
      expect(calculateCompletionRate(3, 6)).toBe(0.5);
    });

    it('returns 0 when totalTrips is zero, negative, or not finite', () => {
      expect(calculateCompletionRate(5, 0)).toBe(0);
      expect(calculateCompletionRate(5, -2)).toBe(0);
      expect(calculateCompletionRate(5, NaN)).toBe(0);
      expect(calculateCompletionRate(5, Infinity)).toBe(0);
      expect(calculateCompletionRate(5, null)).toBe(0);
      expect(calculateCompletionRate(5, undefined)).toBe(0);
    });

    it('returns 0 when completedTrips is not finite', () => {
      expect(calculateCompletionRate(NaN, 10)).toBe(0);
      expect(calculateCompletionRate(Infinity, 10)).toBe(0);
      expect(calculateCompletionRate(-Infinity, 10)).toBe(0);
      expect(calculateCompletionRate(null, 10)).toBe(0);
      expect(calculateCompletionRate(undefined, 10)).toBe(0);
    });
  });

  describe('aggregateTripEarnings', () => {
    it('aggregates normal numeric trip earnings correctly with mixed statuses', () => {
      const trips = [
        { total_earnings: 1000, net_earnings: 800, status: 'completed' },
        { total_earnings: 2000, net_earnings: 1600, status: 'completed' },
        { total_earnings: 500, net_earnings: 400, status: 'cancelled' },
        { total_earnings: 1500, net_earnings: 1200 }, // undefined status counts as completed
      ];

      const result = aggregateTripEarnings(trips);

      expect(result).toEqual({
        totalEarnings: 5000,
        netEarnings: 4000,
        tripCount: 4,
        averageEarnings: 1250, // 5000 / 4
        completionRate: 0.75, // 3 / 4
      });
    });

    it('returns zeros with zero-division guards for empty trip lists', () => {
      const result = aggregateTripEarnings([]);

      expect(result).toEqual({
        totalEarnings: 0,
        netEarnings: 0,
        tripCount: 0,
        averageEarnings: 0,
        completionRate: 0,
      });
    });

    it('handles null, undefined, or non-array trips input safely', () => {
      expect(aggregateTripEarnings(null)).toEqual({
        totalEarnings: 0,
        netEarnings: 0,
        tripCount: 0,
        averageEarnings: 0,
        completionRate: 0,
      });

      expect(aggregateTripEarnings(undefined)).toEqual({
        totalEarnings: 0,
        netEarnings: 0,
        tripCount: 0,
        averageEarnings: 0,
        completionRate: 0,
      });

      expect(aggregateTripEarnings('invalid-trips')).toEqual({
        totalEarnings: 0,
        netEarnings: 0,
        tripCount: 0,
        averageEarnings: 0,
        completionRate: 0,
      });
    });

    it('replaces NaN and Infinity earnings with 0 safely without producing NaN in averages', () => {
      const trips = [
        { total_earnings: NaN, net_earnings: Infinity, status: 'cancelled' },
        { total_earnings: 1000, net_earnings: -Infinity, status: 'completed' },
      ];

      const result = aggregateTripEarnings(trips);

      expect(result.totalEarnings).toBe(1000);
      expect(result.netEarnings).toBe(0);
      expect(result.tripCount).toBe(2);
      expect(result.averageEarnings).toBe(500);
      expect(result.completionRate).toBe(0.5);
    });
  });

  describe('calculateEarningsAggregation (Daily & Weekly Summaries and Edge Cases)', () => {
    it('returns zeroed structure when trips is empty (no-earnings edge case)', () => {
      const result = calculateEarningsAggregation([], [], null);

      expect(result.gross_earnings).toBe(0);
      expect(result.net_earnings).toBe(0);
      expect(result.trips_completed).toBe(0);
      expect(result.average_earnings).toBe(0);
      expect(result.completion_rate).toBe(0);
      expect(result.weekly_chart).toHaveLength(7);
      expect(result.weekly_chart.every((entry) => entry.earnings === 0)).toBe(true);
      expect(result.cumulative_stats.total_km).toBe(0);
      expect(result.cumulative_stats.avg_earning_per_km).toBe(0);
      expect(result.cumulative_stats.lifetime_trips).toBeNull();
      expect(result.deadhead_trips_saved).toBe(0);
    });

    it('returns zeroed structure when trips is null or non-array', () => {
      const result = calculateEarningsAggregation(null, null, null);

      expect(result.gross_earnings).toBe(0);
      expect(result.net_earnings).toBe(0);
      expect(result.trips_completed).toBe(0);
      expect(result.average_earnings).toBe(0);
      expect(result.completion_rate).toBe(0);
      expect(result.weekly_chart).toHaveLength(7);
      expect(result.cumulative_stats.total_km).toBe(0);
      expect(result.cumulative_stats.avg_earning_per_km).toBe(0);
    });

    it('aggregates daily earnings into the correct weekly_chart buckets', () => {
      const now = new Date();
      const todayISO = now.toISOString();
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(); // outside 7-day window
      const futureDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(); // future date (diffDays < 0)

      const trips = [
        { total_earnings: 1000, net_earnings: 800, trip_date: todayISO, status: 'completed' },
        { total_earnings: 500, net_earnings: 400, trip_date: todayISO, status: 'completed' }, // same day accumulation
        { total_earnings: 2000, net_earnings: 1600, trip_date: twoDaysAgo, status: 'completed' },
        { total_earnings: 1500, net_earnings: 1200, trip_date: fiveDaysAgo, status: 'completed' },
        { total_earnings: 3000, net_earnings: 2400, trip_date: tenDaysAgo, status: 'completed' }, // should not appear in weekly chart
        { total_earnings: 800, net_earnings: 640, trip_date: futureDate, status: 'completed' }, // should not appear in weekly chart
      ];

      const result = calculateEarningsAggregation(trips, trips, 6);

      // Total gross and net includes all trips in the list
      expect(result.gross_earnings).toBe(8800);
      expect(result.net_earnings).toBe(7040);
      expect(result.trips_completed).toBe(6);

      // Weekly chart should only aggregate trips within [0..7] days
      const weeklyTotal = result.weekly_chart.reduce((sum, day) => sum + day.earnings, 0);
      expect(weeklyTotal).toBe(1000 + 500 + 2000 + 1500); // 5000
    });

    it('parses various distance formats and calculates avg_earning_per_km safely', () => {
      const trips = [
        { total_earnings: 1200, net_earnings: 1000, distance: '120.5 km', status: 'completed' },
        { total_earnings: 1800, net_earnings: 1500, distance: '150', status: 'completed' },
        { total_earnings: 600, net_earnings: 500, distance: 80, status: 'completed' },
        { total_earnings: 0, net_earnings: 0, distance: '0 km', status: 'cancelled' },
        { total_earnings: 200, net_earnings: 150, distance: null, status: 'completed' },
        { total_earnings: 100, net_earnings: 80, distance: 'invalid-distance', status: 'completed' },
      ];

      const result = calculateEarningsAggregation(trips, trips, 6);

      // Total distance = 120.5 + 150 + 80 = 350.5 km
      expect(result.cumulative_stats.total_km).toBe(350.5);
      expect(result.net_earnings).toBe(3230);
      expect(result.cumulative_stats.avg_earning_per_km).toBeCloseTo(3230 / 350.5, 4);
    });

    it('avoids division by zero when total distance is 0', () => {
      const trips = [
        { total_earnings: 500, net_earnings: 400, distance: '0 km' },
      ];

      const result = calculateEarningsAggregation(trips, trips, 1);

      expect(result.cumulative_stats.total_km).toBe(0);
      expect(result.cumulative_stats.avg_earning_per_km).toBe(0);
    });

    it('tracks deadhead reduction correctly for consecutive trips within 3 days', () => {
      const day1 = new Date('2026-09-10T10:00:00Z').toISOString();
      const day2 = new Date('2026-09-11T14:00:00Z').toISOString(); // 1.16 days later (<= 3 days) -> Match!
      const day3 = new Date('2026-09-16T08:00:00Z').toISOString(); // 4.75 days later (> 3 days) -> No match!
      const day4 = new Date('2026-09-17T12:00:00Z').toISOString(); // 1.16 days later, but routes don't match -> No match!

      const allCompletedTrips = [
        { trip_date: day1, route_label: 'Mumbai → Pune' },
        { trip_date: day2, route_label: '  pune   → Hyderabad' }, // drop 'pune' matches pickup 'pune'
        { trip_date: day3, route_label: 'hyderabad → Bengaluru' }, // drop 'Hyderabad' matches pickup 'hyderabad' but >3 days
        { trip_date: day4, route_label: 'Chennai → Delhi' }, // pickup 'Chennai' != prev drop 'Bengaluru'
      ];

      const result = calculateEarningsAggregation([], allCompletedTrips, 4);

      expect(result.deadhead_trips_saved).toBe(1);
    });

    it('handles malformed route labels and invalid dates in deadhead detection without error', () => {
      const allCompletedTrips = [
        { trip_date: 'invalid-date-1', route_label: 'Mumbai → Pune' },
        { trip_date: 'invalid-date-2', route_label: 'Pune → Hyderabad' },
        { trip_date: new Date().toISOString(), route_label: 'SingleCity' }, // no arrow separator
        { trip_date: new Date().toISOString(), route_label: null },
        { trip_date: new Date().toISOString(), route_label: 'CityA → CityB → CityC' }, // 3 parts, length !== 2
      ];

      const result = calculateEarningsAggregation([], allCompletedTrips, 5);

      expect(result.deadhead_trips_saved).toBe(0);
    });

    it('passes lifetime_trips correctly to cumulative_stats', () => {
      const resWithCount = calculateEarningsAggregation([], [], 128);
      expect(resWithCount.cumulative_stats.lifetime_trips).toBe(128);

      const resWithZero = calculateEarningsAggregation([], [], 0);
      expect(resWithZero.cumulative_stats.lifetime_trips).toBe(0);

      const resWithNull = calculateEarningsAggregation([], [], null);
      expect(resWithNull.cumulative_stats.lifetime_trips).toBeNull();

      const resWithUndefined = calculateEarningsAggregation([], [], undefined);
      expect(resWithUndefined.cumulative_stats.lifetime_trips).toBeNull();
    });
  });

  describe('Default Export', () => {
    it('exports all utility functions on the default object', () => {
      expect(typeof driverEarningsService.calculateAverageEarnings).toBe('function');
      expect(typeof driverEarningsService.calculateCompletionRate).toBe('function');
      expect(typeof driverEarningsService.aggregateTripEarnings).toBe('function');
      expect(typeof driverEarningsService.calculateEarningsAggregation).toBe('function');
      expect(typeof driverEarningsService.toAmount).toBe('function');
    });
  });
});
