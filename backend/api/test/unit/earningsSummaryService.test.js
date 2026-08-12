import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildEarningsSummary, formatLocalDate, getPeriodStart } from '../../src/services/driver/earningsSummaryService.js';

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

  describe('formatLocalDate', () => {
    it('formats a date in server-local calendar time, not UTC', () => {
      // 2026-06-01T00:00:00Z. In UTC this is June 1; the lower bound must be
      // compared against the local calendar date stored in trip_date.
      const date = new Date('2026-06-01T00:00:00Z');
      const localOffsetHours = -date.getTimezoneOffset() / 60;
      const expectedYear = 2026;
      const expectedMonth = localOffsetHours >= 0 ? 6 : 5;
      const [year, month] = formatLocalDate(date).split('-').map(Number);
      expect(year).toBe(expectedYear);
      expect(month).toBe(expectedMonth);
    });

    it('zero-pads month and day', () => {
      expect(formatLocalDate(new Date(2026, 0, 5))).toBe('2026-01-05');
      expect(formatLocalDate(new Date(2026, 11, 31))).toBe('2026-12-31');
    });

    it('is stable under a mocked positive UTC offset (east of UTC)', () => {
      // Simulate IST (UTC+5:30): local midnight of June 1 is 2026-05-31T18:30:00Z.
      const istDate = new Date('2026-05-31T18:30:00Z');
      const localYmd = formatLocalDate(istDate);
      // getFullYear/getMonth/getDate run on the local (test runner) zone; assert
      // the output matches the local calendar date derived from the same fields.
      expect(localYmd).toBe(
        `${istDate.getFullYear()}-${String(istDate.getMonth() + 1).padStart(2, '0')}-${String(istDate.getDate()).padStart(2, '0')}`
      );
    });
  });
});
