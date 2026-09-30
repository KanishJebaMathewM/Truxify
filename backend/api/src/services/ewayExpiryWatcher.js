/**
 * @fileoverview Predictive e-Way Bill Expiry Watcher & Validity Extension Monitor.
 * 
 * Responsibilities:
 * 1. Analyzes live GPS transit speed (km/h) against remaining highway distance.
 * 2. Predicts ETA and detects imminent e-Way bill expiration breaches before arrival.
 * 3. Formulates automated validity extension requests according to Indian GST Rule 138(10).
 */

import logger from '../middleware/logger.js';
import { DomainError } from './order/domainError.js';
import { getEwayBill } from './ewayBillService.js';

const MIN_SPEED_THRESHOLD_KMH = 15; // Minimum expected highway average speed
const DEFAULT_AVG_SPEED_KMH = 45;   // Typical commercial truck speed on Indian national highways
const BUFFER_HOURS_THRESHOLD = 4;   // Trigger warning if ETA is within 4 hours of expiry

/**
 * Evaluates real-time trip progress against e-Way Bill validity.
 * 
 * @param {Object} tripContext - { ewayBillNumber, remainingDistanceKm, currentSpeedKmh, avgSpeedKmh }
 * @returns {Object} Expiry assessment with ETA, breach risk, and recommended extension
 */
export function evaluateEwayExpiryRisk(tripContext) {
  const {
    ewayBillNumber,
    remainingDistanceKm,
    currentSpeedKmh = null,
    avgSpeedKmh = null,
  } = tripContext;

  if (!ewayBillNumber || remainingDistanceKm == null) {
    throw new DomainError(400, { error: 'ewayBillNumber and remainingDistanceKm are required' });
  }

  const ewayRecord = getEwayBill(ewayBillNumber);
  const nowUnix = Math.floor(Date.now() / 1000);

  // If no registered e-Way bill found, simulate 48-hour validity
  const validUntilUnix = ewayRecord?.validUntil || (nowUnix + 3600 * 48);

  const effectiveSpeedKmh = Math.max(
    MIN_SPEED_THRESHOLD_KMH,
    avgSpeedKmh || currentSpeedKmh || DEFAULT_AVG_SPEED_KMH
  );

  const estimatedHoursRemaining = remainingDistanceKm / effectiveSpeedKmh;
  const estimatedSecondsRemaining = Math.round(estimatedHoursRemaining * 3600);
  const estimatedArrivalUnix = nowUnix + estimatedSecondsRemaining;

  const secondsUntilExpiry = validUntilUnix - nowUnix;
  const hoursUntilExpiry = Number((secondsUntilExpiry / 3600).toFixed(2));

  // Risk calculation: ETA exceeds validity or is dangerously close within buffer
  const isExpiredAlready = nowUnix > validUntilUnix;
  const willExpireBeforeArrival = estimatedArrivalUnix > validUntilUnix;
  const isAtRisk = isExpiredAlready || willExpireBeforeArrival || (validUntilUnix - estimatedArrivalUnix < BUFFER_HOURS_THRESHOLD * 3600);

  // Calculate recommended extension duration (Rule 138(10): 1 day per 200 km)
  let recommendedExtensionHours = 0;
  if (isAtRisk) {
    const deficitHours = Math.max(0, (estimatedArrivalUnix - validUntilUnix) / 3600);
    recommendedExtensionHours = Math.max(24, Math.ceil((deficitHours + 8) / 24) * 24);
  }

  const result = {
    ewayBillNumber: String(ewayBillNumber),
    remainingDistanceKm: Number(remainingDistanceKm),
    effectiveSpeedKmh: Number(effectiveSpeedKmh.toFixed(1)),
    estimatedHoursRemaining: Number(estimatedHoursRemaining.toFixed(2)),
    hoursUntilExpiry,
    validUntil: new Date(validUntilUnix * 1000).toISOString(),
    estimatedArrival: new Date(estimatedArrivalUnix * 1000).toISOString(),
    status: isExpiredAlready ? 'EXPIRED' : willExpireBeforeArrival ? 'EXPIRY_CRITICAL' : isAtRisk ? 'EXPIRY_WARNING' : 'COMPLIANT',
    isAtRisk,
    recommendedExtensionHours,
    extensionGuidance: isAtRisk
      ? `Estimated arrival (${result?.estimatedArrival || 'N/A'}) requires extending e-Way Bill by ${recommendedExtensionHours} hours under GST Rule 138(10).`
      : 'e-Way Bill validity is sufficient for remaining transit distance.',
  };

  if (isAtRisk) {
    logger.warn({ ewayBillNumber, status: result.status, remainingDistanceKm }, '[ewayExpiryWatcher] e-Way Bill expiry risk detected');
  }

  return result;
}

export default {
  evaluateEwayExpiryRisk,
};
