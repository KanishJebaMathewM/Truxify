/**
 * Mock Commercial Bypass API integration.
 * In a real-world scenario, this service would communicate with Drivewyze or PrePass API
 * to check carrier credentials and safety scores against the specific weigh station.
 */
import logger from '../middleware/logger.js';

const checkBypassEligibility = async (driverId, lat, lng) => {
  try {
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
  } catch (err) {
    logger.error({ err, driverId, lat, lng }, '[WeighStation] Error checking bypass eligibility');
    return {
      action: 'ERROR',
      supported: false,
      simulated: false,
      stationId: null,
      reason: 'Error checking weigh station bypass eligibility.',
      timestamp: new Date().toISOString(),
    };
  }
};


/**
 * Syncs highly accurate internal air suspension weights with DOT enforcement software.
 * Returns an UNSUPPORTED response until a real WIM provider (Drivewyze/PrePass) API is integrated.
 */
const syncAndTransmitInternalWeights = async (driverId, truckId, axles) => {
  try {
    logger.warn({ driverId, truckId }, '[WeighStation] syncAndTransmitInternalWeights called but no WIM provider is configured -- returning unsupported');
    return {
      action: 'UNSUPPORTED',
      supported: false,
      stationId: null,
      reason: 'Weigh-in-motion sync is not available: no WIM provider (Drivewyze/PrePass) is configured. Configure WIM_PROVIDER_API_KEY to enable.',
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    logger.error({ err, driverId, truckId }, '[WeighStation] Error syncing and transmitting internal weights');
    return {
      action: 'ERROR',
      supported: false,
      stationId: null,
      reason: 'Error syncing internal weights with weigh station enforcement.',
      timestamp: new Date().toISOString(),
    };
  }
};

export { checkBypassEligibility, syncAndTransmitInternalWeights };
