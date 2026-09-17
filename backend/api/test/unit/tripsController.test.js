import { describe, it, expect } from 'vitest';
import { TripsController, totalEarningsPaise, tripsController } from '../../src/controllers/tripsController.js';

describe('TripsController', () => {
  describe('totalEarningsPaise', () => {
    it('sums numeric net_earnings correctly', () => {
      const controller = new TripsController([
        { id: 't1', net_earnings: 15000 },
        { id: 't2', net_earnings: 25000 },
      ]);
      expect(controller.totalEarningsPaise()).toBe(40000);
    });

    it('safely parses string net_earnings via type guard', () => {
      const controller = new TripsController([
        { id: 't1', net_earnings: '15000.50' },
        { id: 't2', net_earnings: '24999.50' },
      ]);
      expect(controller.totalEarningsPaise()).toBe(40000);
    });

    it('handles null, undefined, NaN, and missing net_earnings without throwing', () => {
      const controller = new TripsController([
        { id: 't1', net_earnings: null },
        { id: 't2', net_earnings: undefined },
        { id: 't3', net_earnings: 'invalid_number' },
        { id: 't4' },
      ]);
      expect(controller.totalEarningsPaise()).toBe(0);
    });

    it('handles mixed numeric, string, and null rows', () => {
      const trips = [
        { id: 't1', net_earnings: 10000 },
        { id: 't2', net_earnings: '5000' },
        { id: 't3', net_earnings: null },
        { id: 't4', net_earnings: 2000 },
      ];
      expect(totalEarningsPaise(trips)).toBe(17000);
    });

    it('handles non-array or empty trips gracefully', () => {
      expect(totalEarningsPaise(null)).toBe(0);
      expect(totalEarningsPaise(undefined)).toBe(0);
      expect(totalEarningsPaise([])).toBe(0);
      expect(totalEarningsPaise('not-an-array')).toBe(0);
    });

    it('ignores null or non-object rows in trips list', () => {
      const trips = [null, undefined, 'row', { net_earnings: 500 }];
      expect(tripsController.totalEarningsPaise(trips)).toBe(500);
    });
  });

  describe('completedCount and completionRate', () => {
    it('calculates completedCount and completionRate correctly', () => {
      const controller = new TripsController([
        { id: 't1', status: 'completed' },
        { id: 't2', status: 'cancelled' },
        { id: 't3', status: 'completed' },
        { id: 't4', status: 'in_transit' },
      ]);
      expect(controller.completedCount()).toBe(2);
      expect(controller.completionRate()).toBe(50);
    });

    it('returns 0 completionRate for empty trips', () => {
      const controller = new TripsController([]);
      expect(controller.completedCount()).toBe(0);
      expect(controller.completionRate()).toBe(0);
    });
  });
});
