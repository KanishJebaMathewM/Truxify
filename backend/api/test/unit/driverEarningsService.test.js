import { describe, it, expect } from 'vitest';
import driverEarningsService, {
  toAmount,
  calculateAverageEarnings,
  calculateCompletionRate,
  aggregateTripEarnings,
  calculateEarningsAggregation,
} from '../../src/services/driverEarningsService.js';

describe('driverEarningsService', () => {
  describe('toAmount', () => {
    it('coerces valid numbers and numeric strings to finite numbers', () => {
      expect(toAmount(100)).toBe(100);
      expect(toAmount('250.5')).toBe(250.5);
      expect(toAmount(0)).toBe(0);
    });

    it('returns 0 for null, undefined, NaN, or non-finite inputs', () => {
      expect(toAmount(null)).toBe(0);
      expect(toAmount(undefined)).toBe(0);
      expect(toAmount('invalid')).toBe(0);
      expect(toAmount(Infinity)).toBe(0);
    });
  });

  describe('calculateAverageEarnings', () => {
    it('calculates average earnings per trip correctly', () => {
      expect(calculateAverageEarnings(500, 5)).toBe(100);
      expect(calculateAverageEarnings(1200, 4)).toBe(300);
    });

    it('returns 0 when trip count is 0, negative, or not finite', () => {
      expect(calculateAverageEarnings(500, 0)).toBe(0);
      expect(calculateAverageEarnings(500, -2)).toBe(0);
      expect(calculateAverageEarnings(500, NaN)).toBe(0);
      expect(calculateAverageEarnings(NaN, 5)).toBe(0);
    });
  });

  describe('calculateCompletionRate', () => {
    it('calculates completion rate percentage as ratio', () => {
      expect(calculateCompletionRate(8, 10)).toBe(0.8);
      expect(calculateCompletionRate(10, 10)).toBe(1);
      expect(calculateCompletionRate(0, 5)).toBe(0);
    });

    it('returns 0 for invalid or zero total trips', () => {
      expect(calculateCompletionRate(5, 0)).toBe(0);
      expect(calculateCompletionRate(5, -1)).toBe(0);
      expect(calculateCompletionRate(NaN, 10)).toBe(0);
    });
  });

  describe('aggregateTripEarnings', () => {
    it('aggregates total and net earnings across trip rows', () => {
      const trips = [
        { total_earnings: '500', net_earnings: '450', status: 'completed' },
        { total_earnings: 300, net_earnings: 270, status: 'completed' },
        { total_earnings: 200, net_earnings: 180, status: 'cancelled' },
      ];

      const result = aggregateTripEarnings(trips);
      expect(result.totalEarnings).toBe(1000);
      expect(result.netEarnings).toBe(900);
      expect(result.tripCount).toBe(3);
      expect(result.averageEarnings).toBeCloseTo(333.33, 1);
      expect(result.completionRate).toBeCloseTo(0.666, 2);
    });

    it('handles empty trips array safely', () => {
      const result = aggregateTripEarnings([]);
      expect(result.totalEarnings).toBe(0);
      expect(result.netEarnings).toBe(0);
      expect(result.tripCount).toBe(0);
      expect(result.averageEarnings).toBe(0);
      expect(result.completionRate).toBe(0);
    });

    it('handles non-array trips input safely', () => {
      const result = aggregateTripEarnings(null);
      expect(result.tripCount).toBe(0);
      expect(result.totalEarnings).toBe(0);
    });
  });

  describe('calculateEarningsAggregation', () => {
    it('aggregates earnings, distances, completion rate, and deadhead trips saved', () => {
      const now = new Date();
      const trips = [
        {
          total_earnings: 1500,
          net_earnings: 1350,
          distance: '250 km',
          status: 'completed',
          trip_date: now.toISOString(),
        },
        {
          total_earnings: 800,
          net_earnings: 720,
          distance: '150.5',
          status: 'completed',
          trip_date: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
        },
      ];

      const allCompletedTrips = [
        {
          route_label: 'Mumbai → Pune',
          trip_date: new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString(),
        },
        {
          route_label: 'Pune → Hyderabad',
          trip_date: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
        },
      ];

      const result = calculateEarningsAggregation(trips, allCompletedTrips, 25);
      expect(result.gross_earnings).toBe(2300);
      expect(result.net_earnings).toBe(2070);
      expect(result.trips_completed).toBe(2);
      expect(result.average_earnings).toBe(1150);
      expect(result.completion_rate).toBe(1);
      expect(result.cumulative_stats.total_km).toBe(400.5);
      expect(result.cumulative_stats.avg_earning_per_km).toBeCloseTo(2070 / 400.5, 2);
      expect(result.cumulative_stats.lifetime_trips).toBe(25);
      expect(result.deadhead_trips_saved).toBe(1);
      expect(Array.isArray(result.weekly_chart)).toBe(true);
      expect(result.weekly_chart).toHaveLength(7);
    });

    it('handles empty or missing trips inputs safely', () => {
      const result = calculateEarningsAggregation([], [], null);
      expect(result.gross_earnings).toBe(0);
      expect(result.net_earnings).toBe(0);
      expect(result.trips_completed).toBe(0);
      expect(result.average_earnings).toBe(0);
      expect(result.completion_rate).toBe(0);
      expect(result.cumulative_stats.total_km).toBe(0);
      expect(result.cumulative_stats.avg_earning_per_km).toBe(0);
      expect(result.cumulative_stats.lifetime_trips).toBeNull();
      expect(result.deadhead_trips_saved).toBe(0);
    });

    it('exports default service object matching named functions', () => {
      expect(driverEarningsService.toAmount).toBe(toAmount);
      expect(driverEarningsService.calculateAverageEarnings).toBe(calculateAverageEarnings);
      expect(driverEarningsService.calculateCompletionRate).toBe(calculateCompletionRate);
      expect(driverEarningsService.aggregateTripEarnings).toBe(aggregateTripEarnings);
      expect(driverEarningsService.calculateEarningsAggregation).toBe(calculateEarningsAggregation);
    });
  });
});
