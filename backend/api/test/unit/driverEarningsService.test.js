import { describe, it, expect, vi, beforeEach } from 'vitest';
import driverEarningsService from '../../src/services/driverEarningsService.js';

describe('driverEarningsService.aggregateTripEarnings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should correctly aggregate normal numeric trip earnings', () => {
    const trips = [
      { total_earnings: 1000, net_earnings: 900 },
      { total_earnings: 2000, net_earnings: 1800 },
    ];

    const result = driverEarningsService.aggregateTripEarnings(trips);

    expect(result).toEqual({
      totalEarnings: 3000,
      netEarnings: 2700,
      tripCount: 2,
    });
  });

  it('should handle null or undefined values gracefully by treating them as 0', () => {
    const trips = [
      { total_earnings: null, net_earnings: undefined },
      { total_earnings: 1500, net_earnings: null },
    ];

    const result = driverEarningsService.aggregateTripEarnings(trips);

    expect(result).toEqual({
      totalEarnings: 1500,
      netEarnings: 0,
      tripCount: 2,
    });
  });

  it('should replace NaN earnings values with 0', () => {
    const trips = [
      { total_earnings: NaN, net_earnings: 500 },
      { total_earnings: 1000, net_earnings: Number('invalid') },
    ];

    const result = driverEarningsService.aggregateTripEarnings(trips);

    expect(result).toEqual({
      totalEarnings: 1000,
      netEarnings: 500,
      tripCount: 2,
    });
  });

  it('should handle Infinity or -Infinity earnings values safely', () => {
    const trips = [
      { total_earnings: Infinity, net_earnings: -Infinity },
      { total_earnings: 500, net_earnings: 400 },
    ];

    const result = driverEarningsService.aggregateTripEarnings(trips);

    expect(result.totalEarnings).not.toBeNaN();
    expect(result.netEarnings).not.toBeNaN();
    expect(result.tripCount).toBe(2);
  });

  it('should return zeros for empty trip lists', () => {
    const result = driverEarningsService.aggregateTripEarnings([]);

    expect(result).toEqual({
      totalEarnings: 0,
      netEarnings: 0,
      tripCount: 0,
    });
  });
});
