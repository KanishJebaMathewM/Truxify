/**
 * Driver earnings aggregation logic.
 */

export const calculateEarningsAggregation = (trips, allCompletedTrips, lifetimeTrips) => {
  // Weekly Chart Aggregation (always shows past 7 days)
  const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const weeklyChartMap = {};
  const pad = (n) => String(n).padStart(2, '0');
  const toDateKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    weeklyChartMap[toDateKey(d)] = { day: daysOfWeek[d.getDay()], earnings: 0 };
  }

  let totalKm = 0;
  let totalNetEarnings = 0;
  let gross_earnings = 0;

  (trips || []).forEach(trip => {
    let tEarnings = Number(trip.total_earnings);
    if (Number.isNaN(tEarnings)) {
      tEarnings = 0;
    }

    let nEarnings = Number(trip.net_earnings);
    if (Number.isNaN(nEarnings)) {
      nEarnings = 0;
    }

    if (trip.trip_date) {
      const tripDate = new Date(trip.trip_date);
      // Only add to weekly chart if within the last 7 days (excluding future trips)
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
      // Parse decimal distance values correctly
      const match = String(trip.distance).match(/[0-9.]+/);
      const parsed = match ? parseFloat(match[0]) : 0;
      const distanceNum = isNaN(parsed) ? 0 : parsed;
      totalKm += distanceNum;
    }

    totalNetEarnings += nEarnings;
    gross_earnings += tEarnings;
  });

  const weeklyChart = Object.values(weeklyChartMap);

  let deadheadTripsSaved = 0;
  if (allCompletedTrips && allCompletedTrips.length > 1) {
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
          if (!isNaN(prevDate) && !isNaN(currDate)) {
            const diffDays = Math.abs(currDate - prevDate) / (1000 * 60 * 60 * 24);
            if (diffDays <= 3) {
              deadheadTripsSaved++;
            }
          }
        }
      }
    }
  }

  return {
    gross_earnings,
    net_earnings: totalNetEarnings,
    trips_completed: (trips || []).length,
    weekly_chart: weeklyChart,
    cumulative_stats: {
      total_km: totalKm,
      avg_earning_per_km: totalKm > 0 ? (totalNetEarnings / 100.0) / totalKm : 0,
      lifetime_trips: lifetimeTrips !== null ? lifetimeTrips : null
    },
    deadhead_trips_saved: deadheadTripsSaved
  };
};
