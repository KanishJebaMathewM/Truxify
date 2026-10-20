/**
 * Mock Commercial Bypass API integration.
 * In a real-world scenario, this service would communicate with Drivewyze or PrePass API
 * to check carrier credentials and safety scores against the specific weigh station.
 */
import logger from '../middleware/logger.js';
// backend/api/src/services/weighStationService.js (Excerpt)

import crypto from 'crypto';
import { logger } from '../utils/logger.js';

/**
 * MOCK IMPLEMENTATION: Pending integration with real compliance provider (Drivewyze / PrePass).
 * Evaluates whether a driver is eligible to bypass a weigh station based on location coordinates.
 */
export async function checkBypassEligibility({ lat, lng, vehicleId }) {
  try {
    if (lat === undefined || lng === undefined) {
      throw new Error('Latitude and longitude are required for weigh station check');
    }

    // FIX: Generate deterministic station ID derived from coordinates per issue #6527
    const normalizedLat = Number(lat).toFixed(4);
    const normalizedLng = Number(lng).toFixed(4);
    const stationId = `STATION_${normalizedLat}_${normalizedLng}`;

    // FIX: Replace Math.random() with crypto.randomInt() for secure randomness
    // 30% baseline chance of bypass eligibility in mock mode
    const randomVal = crypto.randomInt(0, 100);
    const isBypassGranted = randomVal < 30;

    logger.info(
      { stationId, vehicleId, isBypassGranted },
      '[weighStationService] Bypass eligibility evaluated (Mock)'
    );

    return {
      success: true,
      stationId,
      bypassGranted: isBypassGranted,
      provider: 'MOCK_COMPLIANCE_PROVIDER',
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    logger.error({ err, lat, lng, vehicleId }, '[weighStationService] Failed to check bypass eligibility');
    return {
      success: false,
      error: `Weigh station check failed: ${err.message}`,
    };
  }
}
const checkBypassEligibility = async (driverId, lat, lng) => {
  // No real WIM/bypass provider (Drivewyze/PrePass) is integrated. The
  // previous implementation returned a Math.random() coin-flip presented as a
  // regulatory verdict, which a driver could legally rely on. There is no real
  // integration to call, so this fails closed and reports itself as
  // unsupported instead of inventing a BYPASS/PULL_IN decision.
  return {
    action: 'UNSUPPORTED',
    supported: false,
    simulated: true,
    stationId: null,
    reason: 'Weigh-in-motion bypass is not available: no WIM provider is configured. This is not a regulatory verdict.',
    timestamp: new Date().toISOString(),
  };
};


/**
 * Syncs highly accurate internal air suspension weights with DOT enforcement software.
 * Returns an UNSUPPORTED response until a real WIM provider (Drivewyze/PrePass) API is integrated.
 */
const syncAndTransmitInternalWeights = async (driverId, truckId, axles) => {
  logger.warn('[WeighStation] syncAndTransmitInternalWeights called but no WIM provider is configured -- returning unsupported');
  return {
    action: 'UNSUPPORTED',
    supported: false,
    stationId: null,
    reason: 'Weigh-in-motion sync is not available: no WIM provider (Drivewyze/PrePass) is configured. Configure WIM_PROVIDER_API_KEY to enable.',
    timestamp: new Date().toISOString(),
  };
};

export { checkBypassEligibility, syncAndTransmitInternalWeights };
