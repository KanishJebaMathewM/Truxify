/**
 * Driver earnings report aggregation.
 *
 * Extracted from the route handler so the arithmetic is unit-testable without
 * HTTP or a database, per the layered architecture in CONTRIBUTING.md.
 */

/** Columns the response actually serialises. Replaces a `select('*')`. */
export const EARNINGS_TRIP_COLUMNS = [
  'trip_display_id',
  'route_label',
  'trip_date',
  'distance',
  'total_earnings',
  'fuel_deducted',
  'net_earnings',
  'blockchain_hash',
].join(', ');

/** Columns needed for the deadhead adjacency scan — nothing more. */
export const DEADHEAD_COLUMNS = 'route_label, trip_date';

/**
 * Maximum gap between two trips for the second to count as avoiding a
 * deadhead run. Matches the existing behaviour.
 */
export const DEADHEAD_MAX_GAP_DAYS = 3;

/**
 * Defensive row cap on the deadhead query. The date bound already limits the
 * scan; this stops a pathological data set from returning an unbounded set.
 */
export const DEADHEAD_MAX_ROWS = 1000;

/** Supported reporting periods and how far back each looks. */
const PERIODS = new Set(['day', 'week', 'month']);

/**
 * Inclusive lower bound for a reporting period.
 *
 * @param {'day'|'week'|'month'} period
 * @param {Date} [now]
 * @returns {Date|null} Null when the period is not recognised.
 */
export function getEarningsCutoff(period, now = new Date()) {
  if (!PERIODS.has(period)) {
    return null;
  }
  const cutoff = new Date(now);
  if (period === 'day') {
    cutoff.setHours(0, 0, 0, 0);
  } else if (period === 'week') {
    cutoff.setDate(cutoff.getDate() - 7);
  } else {
    cutoff.setDate(cutoff.getDate() - 30);
  }
  return cutoff;
}

/**
 * Lower bound for the deadhead adjacency query.
 *
 * The rule only ever compares a trip to its immediate predecessor within
 * DEADHEAD_MAX_GAP_DAYS, so the scan needs the reporting window extended
 * backwards by that gap — not the driver's entire career. Previously this
 * query had no bound at all and grew without limit over a driver's tenure.
 *
 * @param {Date} cutoff Reporting-period lower bound.
 * @returns {Date}
 */
export function getDeadheadCutoff(cutoff) {
  const start = new Date(cutoff);
  start.setDate(start.getDate() - DEADHEAD_MAX_GAP_DAYS);
  return start;
}

/**
 * Format a Date as the `YYYY-MM-DD` string the `trip_date` column stores.
 *
 * @param {Date} date
 * @returns {string}
 */
export function toDateKey(date) {
  return date.toISOString().split('T')[0];
}

/**
 * Coerce a possibly-null numeric column to a finite number.
 *
 * @param {unknown} value
 * @returns {number}
 */
function toAmount(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Parse the numeric distance out of a free-text column such as `"420 km"`.
 *
 * The original read `String(trip.distance, 10)` — `String()` takes a single
 * argument, so the radix was silently ignored. The intent was
 * `parseInt(String(value), 10)`.
 *
 * @param {unknown} value
 * @returns {number} Kilometres, or 0 when unparseable.
 */
export function parseDistanceKm(value) {
  if (value === null || value === undefined) {
    return 0;
  }
  const decimal = String(value).replace(/[^0-9.]/g, '');
  if (decimal.length === 0) {
    return 0;
  }
  const parsed = parseFloat(decimal);
  return Number.isFinite(parsed) ? parsed : 0;
}

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Earnings bucketed by weekday for the past seven days.
 *
 * @param {Array<object>} trips
 * @param {Date} [now]
 * @returns {Array<{day: string, earnings: number}>}
 */
export function buildWeeklyChart(trips, now = new Date()) {
  const buckets = {};
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    buckets[DAYS_OF_WEEK[d.getDay()]] = 0;
  }

  for (const trip of Array.isArray(trips) ? trips : []) {
    const tripDate = new Date(trip.trip_date);
    if (Number.isNaN(tripDate.getTime())) {
      continue;
    }
    const label = DAYS_OF_WEEK[tripDate.getDay()];
    if (buckets[label] !== undefined) {
      buckets[label] += toAmount(trip.total_earnings);
    }
  }

  return Object.entries(buckets).map(([day, earnings]) => ({ day, earnings }));
}

/**
 * Count trips that began where the previous one ended, within the gap window.
 *
 * @param {Array<{route_label?: string, trip_date?: string}>} trips
 *   Completed trips ordered by `trip_date` ascending.
 * @returns {number}
 */
export function countDeadheadTripsSaved(trips) {
  const rows = Array.isArray(trips) ? trips : [];
  if (rows.length < 2) {
    return 0;
  }

  let saved = 0;
  for (let i = 1; i < rows.length; i += 1) {
    const prevRoute = String(rows[i - 1].route_label || '').split(' → ');
    const currRoute = String(rows[i].route_label || '').split(' → ');

    if (prevRoute.length !== 2 || currRoute.length !== 2) {
      continue;
    }

    const prevDrop = prevRoute[1].trim().toLowerCase();
    const currPickup = currRoute[0].trim().toLowerCase();
    if (!prevDrop || prevDrop !== currPickup) {
      continue;
    }

    const prevDate = new Date(rows[i - 1].trip_date);
    const currDate = new Date(rows[i].trip_date);
    if (Number.isNaN(prevDate.getTime()) || Number.isNaN(currDate.getTime())) {
      continue;
    }

    const gapDays = Math.abs(currDate - prevDate) / (1000 * 60 * 60 * 24);
    if (gapDays <= DEADHEAD_MAX_GAP_DAYS) {
      saved += 1;
    }
  }

  return saved;
}

/**
 * Total distance across trips, in kilometres.
 *
 * @param {Array<object>} trips
 * @returns {number}
 */
export function sumDistanceKm(trips) {
  return (Array.isArray(trips) ? trips : []).reduce(
    (total, trip) => total + parseDistanceKm(trip.distance),
    0
  );
}

/**
 * Gross and net totals across trips.
 *
 * @param {Array<object>} trips
 * @returns {{gross: number, net: number}}
 */
export function sumEarnings(trips) {
  const rows = Array.isArray(trips) ? trips : [];
  return {
    gross: rows.reduce((sum, t) => sum + toAmount(t.total_earnings), 0),
    net: rows.reduce((sum, t) => sum + toAmount(t.net_earnings), 0),
  };
}
