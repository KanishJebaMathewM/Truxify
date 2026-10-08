// Lazy-loaded database reference to avoid eagerly opening sockets during unit testing
let cachedSupabase = null;
async function getDbClient() {
  if (cachedSupabase === null) {
    try {
      const dbModule = await import('../config/db.js');
      cachedSupabase = dbModule.supabase || false;
    } catch {
      cachedSupabase = false;
    }
  }
  return cachedSupabase || null;
}


export const TIRE_LIFESPAN_KM = 80000;
export const INITIAL_TREAD_DEPTH_MM = 16.0;
export const LEGAL_MIN_TREAD_STEER_MM = 3.175; // 4/32 inch per FMCSA 393.75
export const LEGAL_MIN_TREAD_OTHER_MM = 1.5875; // 2/32 inch

export const AXLE_WEAR_MULTIPLIERS = Object.freeze({
  steer: 1.25,   // Lateral scrubbing during turning and braking weight transfer
  drive: 1.15,   // Longitudinal tractive torque and acceleration scrub
  trailer: 1.00, // Steady rolling and straight-line drag
});

export const ROAD_CONDITION_FACTORS = Object.freeze({
  good: 1.0,
  average: 1.2,
  poor: 1.5,
  gravel: 1.8,
  unpaved: 2.1,
});

export const WEATHER_FACTORS = Object.freeze({
  clear: 1.0,
  rain: 1.1,
  extreme_heat: 1.35, // High surface road temp accelerates vulcanized rubber breakdown
  snow: 1.45,
});

export const LOAD_WEIGHT_FACTOR = 0.000025; // Continuous weight factor per kg

/**
 * Calculates physics-based tire degradation metrics given operational parameters.
 *
 * @param {Object} params
 * @param {number} params.distanceKm - Distance driven in kilometers
 * @param {number} [params.loadWeightKg=0] - Cargo load weight in kilograms
 * @param {string} [params.roadCondition='good'] - Road quality classification
 * @param {string} [params.weather='clear'] - Ambient weather condition
 * @param {string} [params.axleType='drive'] - Axle position: 'steer', 'drive', or 'trailer'
 * @param {number} [params.currentTreadDepthMm=INITIAL_TREAD_DEPTH_MM] - Starting tread depth
 * @returns {Object} Degradation summary including remaining tread, wear rate, and blowout hazard
 */
export function calculateTripTireDegradation(params) {
  const {
    distanceKm,
    loadWeightKg = 0,
    roadCondition = 'good',
    weather = 'clear',
    axleType = 'drive',
    currentTreadDepthMm = INITIAL_TREAD_DEPTH_MM,
  } = params;

  if (typeof distanceKm !== 'number' || !Number.isFinite(distanceKm) || distanceKm < 0) {
    throw new RangeError('distanceKm must be a non-negative finite number');
  }
  if (typeof loadWeightKg !== 'number' || !Number.isFinite(loadWeightKg) || loadWeightKg < 0) {
    throw new RangeError('loadWeightKg must be a non-negative finite number');
  }

  const normalizedAxle = (axleType || 'drive').toLowerCase();
  const axleMultiplier = AXLE_WEAR_MULTIPLIERS[normalizedAxle] || AXLE_WEAR_MULTIPLIERS.drive;
  const roadFactor = ROAD_CONDITION_FACTORS[roadCondition?.toLowerCase()] || ROAD_CONDITION_FACTORS.good;
  const weatherFactor = WEATHER_FACTORS[weather?.toLowerCase()] || WEATHER_FACTORS.clear;
  const loadFactor = 1.0 + (loadWeightKg * LOAD_WEIGHT_FACTOR);

  const effectiveDistance = distanceKm * axleMultiplier * roadFactor * weatherFactor * loadFactor;
  const wearPercentageDelta = (effectiveDistance / TIRE_LIFESPAN_KM) * 100;

  const mmLost = (effectiveDistance / TIRE_LIFESPAN_KM) * INITIAL_TREAD_DEPTH_MM;
  const newTreadDepthMm = Math.max(0, currentTreadDepthMm - mmLost);

  const legalMinMm = normalizedAxle === 'steer' ? LEGAL_MIN_TREAD_STEER_MM : LEGAL_MIN_TREAD_OTHER_MM;
  const isBelowLegalLimit = newTreadDepthMm <= legalMinMm;
  const requiresReplacement = newTreadDepthMm <= legalMinMm * 1.25 || wearPercentageDelta >= 80;

  // Compute non-linear blowout hazard probability (Weibull-inspired hazard model)
  const treadDepletionRatio = Math.max(0, (INITIAL_TREAD_DEPTH_MM - newTreadDepthMm) / INITIAL_TREAD_DEPTH_MM);
  const heatStress = weather === 'extreme_heat' ? 1.5 : 1.0;
  const overloadStress = loadWeightKg > 20000 ? 1.4 : 1.0;
  const rawHazard = Math.pow(treadDepletionRatio, 3.2) * 0.75 * heatStress * overloadStress;
  const blowoutHazardProbability = Math.min(1.0, parseFloat(rawHazard.toFixed(4)));

  return {
    distanceKm,
    effectiveDistanceKm: parseFloat(effectiveDistance.toFixed(2)),
    axleType: normalizedAxle,
    startingTreadDepthMm: parseFloat(currentTreadDepthMm.toFixed(2)),
    endingTreadDepthMm: parseFloat(newTreadDepthMm.toFixed(2)),
    treadLossMm: parseFloat(mmLost.toFixed(3)),
    legalLimitMm: legalMinMm,
    isBelowLegalLimit,
    requiresReplacement,
    blowoutHazardProbability,
  };
}

/**
 * Evaluates multi-axle fleet telemetry and projects remaining lifespan and rotation timing.
 *
 * @param {string} driverId - Driver identifier
 * @param {Array<Object>} [tripsOverride] - Optional trip records for test injection
 * @returns {Promise<Object>} Prognostics evaluation report
 */
export async function calculateTireWear(driverId, tripsOverride = null) {
  if (!driverId || typeof driverId !== 'string' || driverId.trim() === '') {
    throw new TypeError('driverId must be a non-empty string');
  }

  let trips = tripsOverride;

  if (!trips) {
    const db = await getDbClient();
    if (db) {
      try {
        const { data, error } = await db
          .from('trips')
          .select('distance_km, load_weight_kg, road_condition, weather, axle_type')
          .eq('driver_id', driverId)
          .order('created_at', { ascending: false })
          .limit(100);

      if (!error && data) {
        trips = data;
      }
    } catch {
      // Fall through to default baseline if database is unseeded or offline
    }
  }
}

  if (!trips || trips.length === 0) {
    return {
      driverId,
      hasData: false,
      wearPercentage: 0,
      remainingKm: TIRE_LIFESPAN_KM,
      currentTreadDepthMm: INITIAL_TREAD_DEPTH_MM,
      blowoutHazardScore: 0.01,
      needsReplacement: false,
      rotationRecommended: false,
      message: 'No operational trip history available for predictive prognostics.',
    };
  }

  let totalEffectiveDistance = 0;
  let steerWearKm = 0;
  let driveWearKm = 0;
  let trailerWearKm = 0;

  for (const trip of trips) {
    const dist = trip.distance_km || 0;
    const load = trip.load_weight_kg || 0;
    const road = trip.road_condition || 'good';
    const weather = trip.weather || 'clear';
    const axle = (trip.axle_type || 'drive').toLowerCase();

    const degradation = calculateTripTireDegradation({
      distanceKm: dist,
      loadWeightKg: load,
      roadCondition: road,
      weather,
      axleType: axle,
    });

    totalEffectiveDistance += degradation.effectiveDistanceKm;
    if (axle === 'steer') steerWearKm += degradation.effectiveDistanceKm;
    else if (axle === 'trailer') trailerWearKm += degradation.effectiveDistanceKm;
    else driveWearKm += degradation.effectiveDistanceKm;
  }

  const wearPercentage = Math.min(100, (totalEffectiveDistance / TIRE_LIFESPAN_KM) * 100);
  const remainingKm = Math.max(0, TIRE_LIFESPAN_KM - totalEffectiveDistance);
  const currentTreadDepthMm = Math.max(
    0,
    INITIAL_TREAD_DEPTH_MM - (totalEffectiveDistance / TIRE_LIFESPAN_KM) * INITIAL_TREAD_DEPTH_MM
  );

  const needsReplacement = currentTreadDepthMm <= LEGAL_MIN_TREAD_STEER_MM || wearPercentage >= 80;

  // Uneven axle wear differential triggers rotation recommendation
  const axleMax = Math.max(steerWearKm, driveWearKm, trailerWearKm);
  const axleMin = Math.min(steerWearKm, driveWearKm, trailerWearKm);
  const rotationRecommended = (axleMax - axleMin) > 8000;

  const treadDepletionRatio = Math.max(0, (INITIAL_TREAD_DEPTH_MM - currentTreadDepthMm) / INITIAL_TREAD_DEPTH_MM);
  const blowoutHazardScore = Math.min(1.0, parseFloat((Math.pow(treadDepletionRatio, 3.0) * 0.85).toFixed(3)));

  return {
    driverId,
    hasData: true,
    totalTripsAnalyzed: trips.length,
    wearPercentage: parseFloat(wearPercentage.toFixed(2)),
    remainingKm: parseFloat(remainingKm.toFixed(2)),
    currentTreadDepthMm: parseFloat(currentTreadDepthMm.toFixed(2)),
    blowoutHazardScore,
    needsReplacement,
    rotationRecommended,
    axleDistributionKm: {
      steer: parseFloat(steerWearKm.toFixed(2)),
      drive: parseFloat(driveWearKm.toFixed(2)),
      trailer: parseFloat(trailerWearKm.toFixed(2)),
    },
    message: needsReplacement
      ? 'CRITICAL ALERT: Tire tread depth has reached or breached legal safety thresholds. Immediate replacement required.'
      : rotationRecommended
        ? 'ADVISORY: Significant uneven wear detected between steer and drive axles. Tire rotation recommended.'
        : 'STATUS OK: Fleet tires are operating within safe manufacturer wear envelopes.',
  };
}

export default {
  calculateTripTireDegradation,
  calculateTireWear,
  TIRE_LIFESPAN_KM,
  INITIAL_TREAD_DEPTH_MM,
  LEGAL_MIN_TREAD_STEER_MM,
  LEGAL_MIN_TREAD_OTHER_MM,
  AXLE_WEAR_MULTIPLIERS,
  ROAD_CONDITION_FACTORS,
  WEATHER_FACTORS,
};
