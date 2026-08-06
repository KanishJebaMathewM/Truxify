/**
 * Driver earnings summary aggregation.
 *
 * Kept free of Express, Supabase and middleware imports so the arithmetic is
 * unit-testable in isolation, per the layered architecture in CONTRIBUTING.md
 * (routes stay thin; business logic lives in a service).
 */

/**
 * Typical broker commission this platform removes from the chain, expressed
 * as a fraction of gross freight value. Surfaced to drivers as the saving
 * they make by booking directly.
 */
export const BROKER_COMMISSION_RATE = 0.35;

/**
 * Upper bound on rows read for a single summary. A driver cannot complete
 * more trips than this in either reporting window, so the cap only ever
 * engages on anomalous data — it exists so the query can never become
 * unbounded as trip history grows.
 */
export const MAX_TRIPS_PER_SUMMARY = 500;

/**
 * Start of the requested reporting period.
 *
 * @param {'weekly'|'monthly'} period
 * @returns {Date} Inclusive lower bound for `trip_date`.
 */
export function getPeriodStart(period) {
  const now = new Date();
  if (period === 'weekly') {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    return d;
  }
  // monthly (default) — from the first of the current month
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/**
 * Coerce a possibly-null numeric column to a finite number.
 *
 * `total_earnings` and `fuel_deducted` are both nullable, and a null
 * propagating into the reduce would turn a whole summary into NaN.
 *
 * @param {unknown} value
 * @returns {number}
 */
function toAmount(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Build the summary payload from a driver's completed trips.
 *
 * @param {Array<object>|null|undefined} trips Completed trips in the window.
 * @param {string} period
 * @param {string} driverId
 * @returns {object} Summary in the shape the driver app already consumes.
 */
export function buildEarningsSummary(trips, period, driverId) {
  const rows = Array.isArray(trips) ? trips : [];

  const totalGross = rows.reduce((sum, t) => sum + toAmount(t.total_earnings), 0);
  const totalDeductions = rows.reduce((sum, t) => sum + toAmount(t.fuel_deducted), 0);

  return {
    period,
    driverId,
    totalGross,
    totalDeductions,
    netEarnings: totalGross - totalDeductions,
    tripCount: rows.length,
    // Expressed as a percentage of gross. Constant by definition, but kept in
    // the payload because the driver app renders it directly.
    brokerSavingsPercent: Math.round(BROKER_COMMISSION_RATE * 100),
    brokerSavingsAmount: Math.round(totalGross * BROKER_COMMISSION_RATE),
    trips: rows.map((t) => ({
      id: t.trip_display_id,
      date: t.trip_date,
      distance: t.distance,
      gross: toAmount(t.total_earnings),
      deductions: toAmount(t.fuel_deducted),
      net: toAmount(t.total_earnings) - toAmount(t.fuel_deducted),
    })),
  };
}
