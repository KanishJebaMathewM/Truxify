import { describe, it, expect } from 'vitest';
import { calculateEarningsAggregation } from '../../src/services/driverEarningsService.js';

describe('driverEarningsService', () => {
  describe('calculateEarningsAggregation', () => {
    it('should aggregate earnings correctly with empty trip history', () => {
      const result = calculateEarningsAggregation([], [], 0);
      
      expect(result.gross_earnings).toBe(0);
      expect(result.net_earnings).toBe(0);
      expect(result.trips_completed).toBe(0);
      expect(result.cumulative_stats.total_km).toBe(0);
      expect(result.cumulative_stats.lifetime_trips).toBe(0);
      expect(result.deadhead_trips_saved).toBe(0);
    });

    it('should parse distance correctly and calculate weekly chart bucketed across week boundary', () => {
      const mockTrips = [
        {
          trip_date: new Date().toISOString(), // Today
          total_earnings: 1000,
          net_earnings: 800,
          distance: '50 km'
        },
        {
          trip_date: new Date(new Date().getTime() - 24 * 60 * 60 * 1000).toISOString(), // Yesterday
          total_earnings: 500,
          net_earnings: 400,
          distance: '30.5 km' 
        },
        {
          trip_date: new Date(new Date().getTime() - 8 * 24 * 60 * 60 * 1000).toISOString(), // 8 days ago
          total_earnings: 200,
          net_earnings: 150,
          distance: 'abc10' // parses to 10
        }
      ];

      const result = calculateEarningsAggregation(mockTrips, mockTrips, 15);
      
      expect(result.gross_earnings).toBe(1700);
      expect(result.net_earnings).toBe(1350);
      expect(result.trips_completed).toBe(3);
      expect(result.cumulative_stats.total_km).toBe(50 + 30.5 + 10);
      expect(result.cumulative_stats.lifetime_trips).toBe(15);
      
      // Verify weekly chart excluded the 8-days-ago trip
      const totalChartEarnings = result.weekly_chart.reduce((sum, day) => sum + day.earnings, 0);
      expect(totalChartEarnings).toBe(1500); // 1000 + 500, excluding the 200 from 8 days ago
    });

    it('should calculate deadhead trips saved correctly at exactly 3 days and just beyond', () => {
      const date1 = new Date('2026-08-01T10:00:00Z');
      const date2 = new Date('2026-08-04T10:00:00Z'); // exactly 72 hours gap (3 days)
      const date3 = new Date('2026-08-07T11:00:00Z'); // > 3 days gap
      
      const allCompletedTrips = [
        { route_label: 'City A → City B', trip_date: date1.toISOString() },
        { route_label: 'City B → City C', trip_date: date2.toISOString() }, // Deadhead match (City B), diff <= 3 days -> +1
        { route_label: 'City C → City D', trip_date: date3.toISOString() }, // Deadhead match (City C), diff > 3 days -> +0
      ];

      // Service expects allCompletedTrips to be pre-sorted by date ascending
      const result = calculateEarningsAggregation([], allCompletedTrips, 0);
      expect(result.deadhead_trips_saved).toBe(1);
    });

    it('should handle non-matching route labels and malformed values', () => {
      const allCompletedTrips = [
        { route_label: 'City A → City B', trip_date: new Date('2026-08-01T10:00:00Z').toISOString() },
        { route_label: 'City C → City D', trip_date: new Date('2026-08-02T10:00:00Z').toISOString() }, // No match
        { route_label: 'MalformedRoute', trip_date: new Date('2026-08-03T10:00:00Z').toISOString() }, // Malformed
        { route_label: null, trip_date: new Date('2026-08-04T10:00:00Z').toISOString() } // Null
      ];

      const result = calculateEarningsAggregation([], allCompletedTrips, 0);
      expect(result.deadhead_trips_saved).toBe(0);
    });

    it('should handle null distance and null net_earnings safely', () => {
      const mockTrips = [
        {
          trip_date: new Date().toISOString(),
          total_earnings: 100,
          net_earnings: null,
          distance: null
        }
      ];

      const result = calculateEarningsAggregation(mockTrips, [], 0);
      expect(result.net_earnings).toBe(0);
      expect(result.gross_earnings).toBe(100);
      expect(result.cumulative_stats.total_km).toBe(0);
    });
  });
});
