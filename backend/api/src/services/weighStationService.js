/**
 * Mock Commercial Bypass API integration.
 * In a real-world scenario, this service would communicate with Drivewyze or PrePass API
 * to check carrier credentials and safety scores against the specific weigh station.
 */

const SIMULATED_NETWORK_DELAY_MS = 800;
const STATION_ID_RANGE = 1000;

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

const MAX_GROSS_WEIGHT_LBS = 80000;
const MAX_SINGLE_AXLE_LBS = 20000;
const MAX_TANDEM_AXLE_LBS = 34000;
const PSI_TO_LBS_FACTOR = 250; // Mock calibration factor
const BASE_AXLE_WEIGHT_LBS = 5000; // Unsprung weight

/**
 * Syncs highly accurate internal air suspension weights with DOT enforcement software.
 * Bypasses random pull-in probability if weights are completely legal.
 */
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
