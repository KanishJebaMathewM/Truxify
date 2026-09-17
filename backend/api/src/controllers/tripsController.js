/**
 * TripsController
 * Handles trip calculation, formatting, and aggregations.
 */

export class TripsController {
  constructor(trips = []) {
    this.trips = trips;
  }

  /**
   * Calculates total net earnings in paise from trip records with type safety.
   *
   * @param {Array<object>} [trips] - Optional list of trip records
   * @returns {number} Total earnings in paise
   */
  totalEarningsPaise(trips = this.trips) {
    if (!Array.isArray(trips)) {
      return 0;
    }
    return trips.reduce((sum, row) => {
      if (!row || typeof row !== 'object') {
        return sum;
      }
      const netEarnings = typeof row.net_earnings === 'number'
        ? row.net_earnings
        : parseFloat(row.net_earnings) || 0;
      return sum + netEarnings;
    }, 0);
  }

  /**
   * Returns count of completed trips.
   *
   * @param {Array<object>} [trips]
   * @returns {number}
   */
  completedCount(trips = this.trips) {
    if (!Array.isArray(trips)) {
      return 0;
    }
    return trips.filter((r) => r && r.status === 'completed').length;
  }

  /**
   * Returns completion rate percentage.
   *
   * @param {Array<object>} [trips]
   * @returns {number}
   */
  completionRate(trips = this.trips) {
    if (!Array.isArray(trips) || trips.length === 0) {
      return 0;
    }
    return (this.completedCount(trips) / trips.length) * 100;
  }
}

export function totalEarningsPaise(trips) {
  const controller = new TripsController();
  return controller.totalEarningsPaise(trips);
}

export const tripsController = new TripsController();
export default tripsController;
