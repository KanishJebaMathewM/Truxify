import { ValidationError } from '../utils/errors.js';

/**
 * IFTA quarterly tax report generation.
 *
 * IFTA reports are a legal filing, so two rules apply to everything below:
 * a number that reaches the output must be a real number, and it must never be
 * invented. The previous implementation violated both — a waypoint with a
 * missing coordinate turned the whole report into `NaN`, and a report with no
 * fuel data reported a hardcoded 6.5 MPG average as if it had been measured.
 */

const EARTH_RADIUS_MILES = 3958.8;
const DEFAULT_JURISDICTION = 'UNKNOWN';
const MIN_LATITUDE = -90;
const MAX_LATITUDE = 90;
const MIN_LONGITUDE = -180;
const MAX_LONGITUDE = 180;

/**
 * Coerces a coordinate, rejecting values that are not usable numbers.
 * `Number(null)` and `Number('')` are both `0`, so nullish and blank values are
 * rejected before coercion rather than being read as a position on the equator.
 */
function toCoordinate(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  if (typeof value === 'boolean') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function assertFiniteCoordinate(value, field) {
  const n = toCoordinate(value);
  if (n === null) {
    throw new ValidationError(`${field} must be a finite number`);
  }
  return n;
}

/**
 * Normalizes a jurisdiction to a stable bucket key.
 *
 * Upper-casing matters for tax aggregation: without it 'CA' and 'ca' become two
 * separate jurisdictions and the mileage is split across two report lines.
 */
function normalizeJurisdiction(value) {
  if (typeof value !== 'string') return DEFAULT_JURISDICTION;
  const trimmed = value.trim().toUpperCase();
  return trimmed === '' ? DEFAULT_JURISDICTION : trimmed;
}

/**
 * Validates a fuel measurement. Negative gallons or tax would understate what is
 * owed, so they are rejected rather than subtracted from a jurisdiction total.
 */
function assertNonNegativeAmount(value, field) {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new ValidationError(`${field} must be a finite number`);
  }
  if (n < 0) {
    throw new ValidationError(`${field} must not be negative`);
  }
  return n;
}

/**
 * Great-circle distance in miles between two WGS84 points.
 *
 * Throws rather than returning `NaN`: a `NaN` leg used to propagate into
 * `grandTotalMiles` and surface as `totalMilesDriven: NaN` in the filed report.
 *
 * @returns {number} distance in miles, rounded to 2 decimals
 */
export function calculateDistanceMiles(lat1, lon1, lat2, lon2) {
  const startLat = assertFiniteCoordinate(lat1, 'waypoint latitude');
  const startLon = assertFiniteCoordinate(lon1, 'waypoint longitude');
  const endLat = assertFiniteCoordinate(lat2, 'waypoint latitude');
  const endLon = assertFiniteCoordinate(lon2, 'waypoint longitude');

  for (const [label, value, min, max] of [
    ['waypoint latitude', startLat, MIN_LATITUDE, MAX_LATITUDE],
    ['waypoint longitude', startLon, MIN_LONGITUDE, MAX_LONGITUDE],
    ['waypoint latitude', endLat, MIN_LATITUDE, MAX_LATITUDE],
    ['waypoint longitude', endLon, MIN_LONGITUDE, MAX_LONGITUDE],
  ]) {
    if (value < min || value > max) {
      throw new ValidationError(`${label} must be between ${min} and ${max}`);
    }
  }

  const dLat = (endLat - startLat) * (Math.PI / 180);
  const dLon = (endLon - startLon) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(startLat * (Math.PI / 180)) *
      Math.cos(endLat * (Math.PI / 180)) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return parseFloat((EARTH_RADIUS_MILES * c).toFixed(2));
}

/** Creates (or returns) the accumulator for a jurisdiction. */
function bucketFor(jurisdictions, jurisdiction) {
  let bucket = jurisdictions.get(jurisdiction);
  if (!bucket) {
    bucket = { totalMilesDriven: 0, taxableGallonsPurchased: 0, taxPaidUSD: 0 };
    jurisdictions.set(jurisdiction, bucket);
  }
  return bucket;
}

/**
 * Evaluates GPS waypoints and fuel transactions to compile a quarterly IFTA report.
 *
 * @param {Object} params - { truckId, quarter, year, waypoints, fuelPurchases }
 * @returns {Object} Jurisdiction mileage breakdown, fuel usage, and net taxable balance
 */
export function generateIftaReport(params) {
  if (!params || typeof params !== 'object') {
    throw new ValidationError('IFTA report parameters are required');
  }

  const {
    truckId,
    quarter = 'Q3',
    year = 2026,
    waypoints = [],
    fuelPurchases = []
  } = params;

  if (!truckId || typeof truckId !== 'string') {
    throw new ValidationError('truckId is required');
  }
  if (!Array.isArray(waypoints)) {
    throw new ValidationError('waypoints must be an array');
  }
  if (!Array.isArray(fuelPurchases)) {
    throw new ValidationError('fuelPurchases must be an array');
  }

  // A Map is used instead of a plain object because the jurisdiction key comes
  // from request data. With a plain object, `jurisdictionState: "__proto__"` is
  // truthy, so the accumulator was never created and the subsequent
  // `+=` wrote mileage onto `Object.prototype` for the whole process.
  const jurisdictions = new Map();

  for (let i = 1; i < waypoints.length; i += 1) {
    const prev = waypoints[i - 1];
    const curr = waypoints[i];

    if (!prev || typeof prev !== 'object' || !curr || typeof curr !== 'object') {
      throw new ValidationError(`waypoints[${i - 1}] and waypoints[${i}] must be objects`);
    }

    const jurisdiction = normalizeJurisdiction(
      curr.jurisdictionState ?? prev.jurisdictionState
    );

    try {
      const miles = calculateDistanceMiles(
        prev.latitude,
        prev.longitude,
        curr.latitude,
        curr.longitude
      );
      bucketFor(jurisdictions, jurisdiction).totalMilesDriven += miles;
    } catch (err) {
      if (err instanceof ValidationError) {
        throw new ValidationError(
          `Invalid GPS waypoint between index ${i - 1} and ${i}: ${err.message}`
        );
      }
      throw err;
    }
  }

  fuelPurchases.forEach((purchase, index) => {
    if (!purchase || typeof purchase !== 'object') {
      throw new ValidationError(`fuelPurchases[${index}] must be an object`);
    }
    const bucket = bucketFor(jurisdictions, normalizeJurisdiction(purchase.jurisdictionState));
    bucket.taxableGallonsPurchased += assertNonNegativeAmount(purchase.gallons, 'gallons');
    bucket.taxPaidUSD += assertNonNegativeAmount(purchase.taxPaidUSD, 'taxPaidUSD');
  });

  let grandTotalMiles = 0;
  let grandTotalGallons = 0;

  const jurisdictionBreakdown = Array.from(jurisdictions.entries())
    .map(([jurisdictionState, entry]) => {
      const miles = parseFloat(entry.totalMilesDriven.toFixed(2));
      const gallons = parseFloat(entry.taxableGallonsPurchased.toFixed(2));
      const taxPaid = parseFloat(entry.taxPaidUSD.toFixed(2));

      grandTotalMiles += miles;
      grandTotalGallons += gallons;

      return { jurisdictionState, totalMilesDriven: miles, taxableGallonsPurchased: gallons, taxPaidUSD: taxPaid };
    })
    .sort((a, b) => a.jurisdictionState.localeCompare(b.jurisdictionState));

  // No invented figures: with no fuel data there is no measurable MPG, so the
  // field is null instead of a plausible-looking hardcoded 6.5.
  const fleetAverageMpg = grandTotalGallons > 0
    ? parseFloat((grandTotalMiles / grandTotalGallons).toFixed(2))
    : null;

  return {
    truckId,
    period: `${quarter} ${year}`,
    summary: {
      totalMilesDriven: parseFloat(grandTotalMiles.toFixed(2)),
      totalGallonsPurchased: parseFloat(grandTotalGallons.toFixed(2)),
      fleetAverageMpg
    },
    jurisdictionBreakdown,
    generatedAt: new Date().toISOString()
  };
}
