import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildEarningsSummary, getPeriodStart } from '../../src/services/driver/earningsSummaryService.js';

describe('earningsSummaryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('buildEarningsSummary', () => {
    it('calculates correct total gross from trip earnings', () => {
      const trips = [
        { total_earnings: '10000', fuel_deducted: '0' },
        { total_earnings: '15000', fuel_deducted: '0' },
      ];
      const result = buildEarningsSummary(trips, 'monthly', 'driver-1');
      expect(result.totalGross).toBe(25000);
      expect(result.tripCount).toBe(2);
      expect(result.netEarnings).toBe(25000);
    });

    it('returns zero earnings when trips array is empty', () => {
      const result = buildEarningsSummary([], 'monthly', 'driver-new');
      expect(result.totalGross).toBe(0);
      expect(result.tripCount).toBe(0);
      expect(result.netEarnings).toBe(0);
    });

    it('handles null/undefined trips gracefully', () => {
      const result = buildEarningsSummary(null, 'weekly', 'driver-null');
      expect(result.totalGross).toBe(0);
      expect(result.tripCount).toBe(0);
    });

    it('includes broker savings in the response', () => {
      const trips = [
        { total_earnings: '10000', fuel_deducted: '0' },
      ];
      const result = buildEarningsSummary(trips, 'monthly', 'driver-1');
      expect(result.brokerSavingsAmount).toBe(3500); // 35% of 10000
      expect(result.brokerSavingsPercent).toBe(35);
    });

    it('serialises each trip into the response shape', () => {
      const trips = [
        {
          trip_display_id: 'T-1',
          trip_date: '2026-08-10',
          distance: '420 km',
          total_earnings: '10000',
          fuel_deducted: '2000',
        },
      ];
      const result = buildEarningsSummary(trips, 'weekly', 'driver-1');
      expect(result.trips).toEqual([
        {
          id: 'T-1',
          date: '2026-08-10',
          distance: '420 km',
          gross: 10000,
          deductions: 2000,
          net: 8000,
        },
      ]);
    });

    it('coerces null earnings to zero in the trip serialisation', () => {
      const trips = [
        { trip_display_id: 'T-2', total_earnings: null, fuel_deducted: null },
      ];
      const result = buildEarningsSummary(trips, 'monthly', 'driver-1');
      expect(result.trips[0]).toMatchObject({ gross: 0, deductions: 0, net: 0 });
    });
  });

  describe('getPeriodStart', () => {
    it('returns a Date for weekly period', () => {
      const result = getPeriodStart('weekly');
      expect(result).toBeInstanceOf(Date);
    });

    it('returns a Date for monthly period', () => {
      const result = getPeriodStart('monthly');
      expect(result).toBeInstanceOf(Date);
    });

    it('defaults to monthly when period is unknown', () => {
      const result = getPeriodStart('unknown');
      expect(result).toBeInstanceOf(Date);
    });
  });
});
