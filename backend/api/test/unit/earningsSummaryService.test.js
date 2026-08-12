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
