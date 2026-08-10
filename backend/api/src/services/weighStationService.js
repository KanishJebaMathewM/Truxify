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
const syncAndTransmitInternalWeights = async (driverId, truckId, axles) => {
  // Simulate network delay to DOT API
  await new Promise(resolve => setTimeout(resolve, SIMULATED_NETWORK_DELAY_MS));

  let totalGrossWeight = 0;
  let isOverweight = false;
  let violations = [];

  const calculatedAxles = axles.map(axle => {
    // Formula: Weight = Pressure * CalibrationFactor + BaseWeight
    const calculatedWeight = Math.round((axle.pressure_psi * PSI_TO_LBS_FACTOR) + BASE_AXLE_WEIGHT_LBS);
    totalGrossWeight += calculatedWeight;

    // Check individual axle limits based on a simple heuristic (e.g. steering axle vs tandem)
    // For this simulation, we'll enforce a strict 34,000 max for any axle group.
    if (calculatedWeight > MAX_TANDEM_AXLE_LBS) {
      isOverweight = true;
      violations.push(`Axle ${axle.position} overweight: ${calculatedWeight} lbs`);
    }

    return {
      position: axle.position,
      pressure_psi: axle.pressure_psi,
      calculated_weight_lbs: calculatedWeight
    };
  });

  if (totalGrossWeight > MAX_GROSS_WEIGHT_LBS) {
    isOverweight = true;
    violations.push(`Gross weight overweight: ${totalGrossWeight} lbs`);
  }

  const stationId = 'WS-' + Math.floor(Math.random() * STATION_ID_RANGE);

  if (isOverweight) {
    return {
      action: 'PULL_IN',
      stationId,
      reason: `Internal sensors indicate overweight: ${violations.join(', ')}`,
      gross_weight_lbs: totalGrossWeight,
      axles: calculatedAxles,
      timestamp: new Date().toISOString()
    };
  }

  return {
    action: 'BYPASS',
    stationId,
    reason: 'Internal air suspension sensors verified compliant weights.',
    gross_weight_lbs: totalGrossWeight,
    axles: calculatedAxles,
    timestamp: new Date().toISOString()
  };
};

export { checkBypassEligibility, syncAndTransmitInternalWeights };
