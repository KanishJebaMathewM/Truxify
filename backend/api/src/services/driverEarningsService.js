/**
 * Driver earnings aggregation and statistics calculation service.
 */

/**
 * Coerce a numeric value to a finite number, or 0.
 *
 * @param {unknown} value
 * @returns {number}
 */
export function toAmount(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Calculate average earnings per trip safely with zero-division guard.
 *
 * @param {number} totalEarnings
 * @param {number} count
 * @returns {number}
 */
export function calculateAverageEarnings(totalEarnings, count) {
  if (!Number.isFinite(count) || count <= 0 || !Number.isFinite(totalEarnings)) {
    return 0;
  }
  return totalEarnings / count;
}

/**
 * Calculate trip completion rate safely with zero-division guard.
 *
 * @param {number} completedTrips
 * @param {number} totalTrips
 * @returns {number}
 */
export function calculateCompletionRate(completedTrips, totalTrips) {
  if (!Number.isFinite(totalTrips) || totalTrips <= 0 || !Number.isFinite(completedTrips)) {
    return 0;
  }
  return completedTrips / totalTrips;
}

/**
 * Aggregate earnings and counts from a list of trips.
 *
 * @param {Array<object>} trips
 * @returns {object}
 */
export function aggregateTripEarnings(trips = []) {
  const rows = Array.isArray(trips) ? trips : [];
  let totalEarnings = 0;
  let netEarnings = 0;
  let completedCount = 0;

  for (const trip of rows) {
    const tEarn = toAmount(trip.total_earnings);
    const nEarn = toAmount(trip.net_earnings);
    totalEarnings += tEarn;
    netEarnings += nEarn;
    if (trip.status === 'completed' || trip.status === undefined) {
      completedCount += 1;
    }
  }

  const tripCount = rows.length;
  const averageEarnings = (Number.isFinite(tripCount) && tripCount > 0 && Number.isFinite(totalEarnings))
    ? totalEarnings / tripCount
    : 0;

  const completionRate = (Number.isFinite(tripCount) && tripCount > 0 && Number.isFinite(completedCount))
    ? completedCount / tripCount
    : 0;

  return {
    totalEarnings,
    netEarnings,
    tripCount,
    averageEarnings,
    completionRate,
  };
}

/**
 * Aggregate driver earnings for summary reporting.
 *
 * @param {Array<object>} trips Trips in the current window.
 * @param {Array<object>} allCompletedTrips All completed trips for deadhead calculation.
 * @param {number|null} lifetimeTrips Total lifetime trips count.
 * @returns {object}
 */
export const calculateEarningsAggregation = (trips, allCompletedTrips, lifetimeTrips) => {
  const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const weeklyChartMap = {};
  const toDateKey = (date) => date.toISOString().slice(0, 10);

  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    weeklyChartMap[toDateKey(d)] = { day: daysOfWeek[d.getUTCDay()], earnings: 0 };
  }

  let totalKm = 0;
  let totalNetEarnings = 0;
  let grossEarnings = 0;
  let completedTripsCount = 0;
  const tripList = Array.isArray(trips) ? trips : [];

  tripList.forEach((trip) => {
    const tEarnings = toAmount(trip.total_earnings);
    const nEarnings = toAmount(trip.net_earnings);

    if (trip.trip_date) {
      const tripDate = new Date(trip.trip_date);
      const diffMs = new Date() - tripDate;
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      if (diffDays >= 0 && diffDays <= 7) {
        const dateKey = toDateKey(tripDate);
        if (weeklyChartMap[dateKey] !== undefined) {
          weeklyChartMap[dateKey].earnings += tEarnings;
        }
      }
    }

    if (trip.distance) {
      const match = String(trip.distance).match(/[0-9.]+/);
      const parsed = match ? parseFloat(match[0]) : 0;
      const distanceNum = Number.isFinite(parsed) ? parsed : 0;
      totalKm += distanceNum;
    }

    if (trip.status === 'completed' || trip.status === undefined) {
      completedTripsCount += 1;
    }

    totalNetEarnings += nEarnings;
    grossEarnings += tEarnings;
  });

  const weeklyChart = Object.values(weeklyChartMap);

  let deadheadTripsSaved = 0;
  if (Array.isArray(allCompletedTrips) && allCompletedTrips.length > 1) {
    for (let i = 1; i < allCompletedTrips.length; i++) {
      const prevTrip = allCompletedTrips[i - 1];
      const currTrip = allCompletedTrips[i];

      const prevRoute = (prevTrip.route_label || '').split(' → ');
      const currRoute = (currTrip.route_label || '').split(' → ');

      if (prevRoute.length === 2 && currRoute.length === 2) {
        const prevDrop = prevRoute[1].trim().toLowerCase();
        const currPickup = currRoute[0].trim().toLowerCase();

        if (prevDrop === currPickup) {
          const prevDate = new Date(prevTrip.trip_date);
          const currDate = new Date(currTrip.trip_date);
          if (!isNaN(prevDate.getTime()) && !isNaN(currDate.getTime())) {
            const diffDays = Math.abs(currDate - prevDate) / (1000 * 60 * 60 * 24);
            if (diffDays <= 3) {
              deadheadTripsSaved += 1;
            }
          }
        }
      }
    }
  }

  const avgEarningPerKm = (Number.isFinite(totalKm) && totalKm > 0 && Number.isFinite(totalNetEarnings))
    ? totalNetEarnings / totalKm
    : 0;

  const totalTripsCount = tripList.length;
  const averageEarningsPerTrip = (Number.isFinite(totalTripsCount) && totalTripsCount > 0 && Number.isFinite(grossEarnings))
    ? grossEarnings / totalTripsCount
    : 0;

  const completionRate = (Number.isFinite(totalTripsCount) && totalTripsCount > 0 && Number.isFinite(completedTripsCount))
    ? completedTripsCount / totalTripsCount
    : 0;

  return {
    gross_earnings: grossEarnings,
    net_earnings: totalNetEarnings,
    trips_completed: completedTripsCount,
    average_earnings: averageEarningsPerTrip,
    completion_rate: completionRate,
    weekly_chart: weeklyChart,
    cumulative_stats: {
      total_km: totalKm,
      avg_earning_per_km: avgEarningPerKm,
      lifetime_trips: lifetimeTrips !== null && lifetimeTrips !== undefined ? lifetimeTrips : null,
    },
    deadhead_trips_saved: deadheadTripsSaved,
  };
};

const driverEarningsService = {
  toAmount,
  calculateAverageEarnings,
  calculateCompletionRate,
  aggregateTripEarnings,
  calculateEarningsAggregation,
};

export default driverEarningsService;
