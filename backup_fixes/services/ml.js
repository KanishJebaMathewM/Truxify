// Default URL: localhost works for host-to-container, ML_ENGINE_URL env var
// overrides for Docker Compose container-to-container communication.
const DEFAULT_ML_ENGINE_URL = 'http://localhost:8001';

// Startup validation: warn if ML_API_KEY is not set
if (!process.env.ML_API_KEY) {
  // Use console.warn here since logger may not be initialized at module load time
  console.warn('[ML] WARNING: ML_API_KEY is not set. ML features will be unavailable.');
}

/**
 * Returns standard headers including API key authentication.
 */
function getHeaders() {
  const headers = {
    'Content-Type': 'application/json',
  };
  if (process.env.ML_API_KEY) {
    headers['X-API-Key'] = process.env.ML_API_KEY;
  }
  return headers;
}

async function handleResponse(response) {
  if (response.status === 401 || response.status === 403) {
    const text = await response.text();
    throw new Error(`ML Engine authentication failed: ${response.status} — check ML_API_KEY configuration`);
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ML Engine request failed: ${response.statusText} (${text})`);
  }
  return response.json();
}

function getBaseUrl() {
  return process.env.ML_ENGINE_URL || process.env.ML_SERVICE_URL || DEFAULT_ML_ENGINE_URL;
}

function getPriceBaseUrl() {
  return process.env.ML_ENGINE_URL || process.env.ML_SERVICE_URL || DEFAULT_ML_ENGINE_URL;
}

/**
 * Predicts ride/truck demand by calling the FastAPI ML engine service.
 *
 * @param {object} features
 * @param {number} features.hour
 * @param {number} features.day_of_week
 * @param {number} features.temperature
 * @param {number} features.precipitation
 * @param {number} features.historical_volume
 * @param {number} features.nearby_drivers
 * @returns {Promise<object>} response from the ML engine
 */
export async function predictDemand(features) {
  const url = `${getBaseUrl()}/predict/demand`;

  const response = await fetch(url, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(features),
    signal: AbortSignal.timeout(5000),
  });

  return handleResponse(response);
}

/**
 * Predicts freight price by calling the FastAPI ML engine service.
 *
 * @param {object} params
 * @param {number} params.distanceKm - Route distance in kilometres
 * @param {number} params.cargoWeightKg - Cargo weight in kilograms
 * @param {string} [params.truckType] - Type of truck
 * @param {string} [params.routeOrigin] - Origin location
 * @param {string} [params.routeDestination] - Destination location
 * @param {number} [params.hourOfDay] - Hour of day (0-23)
 * @param {number} [params.dayOfWeek] - Day of week (0-6)
 * @param {number} [params.month] - Month (1-12)
 * @param {number} [params.fuelPrice] - Current fuel price in INR/L
 * @param {string} [params.cargoType] - Type of cargo
 * @returns {Promise<{estimated_price: number, min_price: number, max_price: number, currency: string}>} price prediction
 */
export async function predictPrice({ distanceKm, cargoWeightKg, truckType, routeOrigin, routeDestination, hourOfDay, dayOfWeek, month, fuelPrice, cargoType } = {}) {
  const url = `${getPriceBaseUrl()}/predict`;

  const response = await fetch(url, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      distance_km: distanceKm,
      cargo_weight_kg: cargoWeightKg,
      truck_type: truckType || 'medium_truck',
      route_origin: routeOrigin || '',
      route_destination: routeDestination || '',
      hour_of_day: hourOfDay,
      day_of_week: dayOfWeek,
      month: month,
      fuel_price: fuelPrice,
      cargo_type: cargoType,
    }),
    signal: AbortSignal.timeout(5000),
  });

  return handleResponse(response);
}

/**
 * Predicts ETA for a delivery route.
 *
 * @param {object} params
 * @param {number} params.routeDistance - Route distance in km
 * @param {number} params.timeOfDay - Hour of day (0-23)
 * @param {number} params.dayOfWeek - Day of week (0-6)
 * @param {string} params.routeType - 'highway' or 'city'
 * @param {number} params.historicalSpeed - Historical average speed in km/h
 * @returns {Promise<{eta_minutes: number, confidence_interval: object}>}
 */
export async function predictEta({ routeDistance, timeOfDay, dayOfWeek, routeType, historicalSpeed } = {}) {
  const url = `${getBaseUrl()}/predict/eta`;

  const response = await fetch(url, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      route_distance: routeDistance,
      time_of_day: timeOfDay,
      day_of_week: dayOfWeek,
      route_type: routeType,
      historical_speed: historicalSpeed,
    }),
    signal: AbortSignal.timeout(5000),
  });

  return handleResponse(response);
}

/**
 * Matches loads with drivers using bilateral optimization.
 *
 * @param {object} params
 * @param {Array} params.loads - Available loads with origin/dest/weight/dimensions/deadline
 * @param {Array} params.drivers - Available drivers with location/truck specs/rating
 * @returns {Promise<{assignments: Array, unmatched_loads: Array, unmatched_drivers: Array}>}
 */
export async function matchBilateral({ loads, drivers } = {}) {
  const url = `${getBaseUrl()}/match/bilateral`;

  const response = await fetch(url, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ loads, drivers }),
    signal: AbortSignal.timeout(10000),
  });

  return handleResponse(response);
}

/**
 * Predicts a driver's net earnings for a load.
 *
 * @param {object} params
 * @param {number} params.routeDistance - Route distance in km
 * @param {number} params.fuelPrice - Fuel price in INR/L
 * @param {number} params.tollEstimate - Estimated toll costs in INR
 * @param {number} params.truckMileage - Truck fuel efficiency in km/L
 * @param {number} params.cargoWeight - Cargo weight in kg
 * @param {number} params.tripDuration - Estimated trip duration in hours
 * @returns {Promise<{predicted_profit: number, confidence_interval: object}>}
 */
export async function predictDriverProfit({ routeDistance, fuelPrice, tollEstimate, truckMileage, cargoWeight, tripDuration } = {}) {
  const url = `${getBaseUrl()}/predict/driver-profit`;

  const response = await fetch(url, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      route_distance: routeDistance,
      fuel_price: fuelPrice,
      toll_estimate: tollEstimate,
      truck_mileage: truckMileage,
      cargo_weight: cargoWeight,
      trip_duration: tripDuration,
    }),
    signal: AbortSignal.timeout(5000),
  });

  return handleResponse(response);
}

/**
 * Optimises packing arrangement and delivery sequence.
 *
 * @param {object} params
 * @param {Array} params.packages - Packages with length/width/height/weight
 * @param {object} params.truck - Truck dimensions and max weight
 * @param {Array} params.deliveryAddresses - Delivery locations with lat/lng
 * @returns {Promise<{packing_arrangement: Array, unpacked_packages: Array, stop_sequence: Array, utilization_pct: number}>}
 */
export async function optimisePacking({ packages, truck, deliveryAddresses } = {}) {
  const url = `${getBaseUrl()}/optimise/packing`;

  const response = await fetch(url, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      packages,
      truck,
      delivery_addresses: deliveryAddresses,
    }),
    signal: AbortSignal.timeout(10000),
  });

  return handleResponse(response);
}

/**
 * Recommends loads for a user based on collaborative filtering.
 *
 * @param {object} params
 * @param {string} params.userId - User ID
 * @param {Array} params.bookingHistory - Past bookings
 * @param {Array} params.ratedDrivers - Drivers the user has rated
 * @param {number} [params.topN=5] - Number of recommendations
 * @returns {Promise<{recommendations: Array}>}
 */
export async function recommendLoads({ userId, bookingHistory, ratedDrivers, topN } = {}) {
  const url = `${getBaseUrl()}/recommend/loads`;

  const response = await fetch(url, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      user_id: userId,
      booking_history: bookingHistory || [],
      rated_drivers: ratedDrivers || [],
      top_n: topN || 5,
    }),
    signal: AbortSignal.timeout(5000),
  });

  return handleResponse(response);
}

/**
 * Recommends trucks/drivers for a user based on collaborative filtering.
 *
 * @param {object} params
 * @param {string} params.userId - User ID
 * @param {Array} params.bookingHistory - Past bookings
 * @param {Array} params.ratedLoads - Loads the user has rated
 * @param {number} [params.topN=5] - Number of recommendations
 * @returns {Promise<{recommendations: Array}>}
 */
export async function recommendTrucks({ userId, bookingHistory, ratedLoads, topN } = {}) {
  const url = `${getBaseUrl()}/recommend/trucks`;

  const response = await fetch(url, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      user_id: userId,
      booking_history: bookingHistory || [],
      rated_loads: ratedLoads || [],
      top_n: topN || 5,
    }),
    signal: AbortSignal.timeout(5000),
  });

  return handleResponse(response);
}

/**
 * Scores a user's trustworthiness and risk level.
 *
 * @param {object} params
 * @param {number} params.cancellationRate - Rate of cancellations (0-1)
 * @param {number} params.onTimePct - On-time delivery percentage (0-100)
 * @param {number} params.avgRating - Average rating (1-5)
 * @param {number} params.disputeCount - Number of disputes
 * @param {boolean} params.isVerified - Whether the user is verified
 * @returns {Promise<{trust_score: number, risk_category: string}>}
 */
export async function scoreTrust({ cancellationRate, onTimePct, avgRating, disputeCount, isVerified } = {}) {
  const url = `${getBaseUrl()}/score/trust`;

  const response = await fetch(url, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      cancellation_rate: cancellationRate,
      on_time_pct: onTimePct,
      avg_rating: avgRating,
      dispute_count: disputeCount,
      is_verified: isVerified,
    }),
    signal: AbortSignal.timeout(5000),
  });

  return handleResponse(response);
}

/**
 * Finds return loads to reduce deadhead (empty return) trips.
 *
 * @param {object} params
 * @param {object} params.driverDestination - Driver's destination {lat, lng}
 * @param {object} params.truckSpecs - Truck specifications
 * @param {string} params.arrivalTime - Estimated arrival time (ISO format)
 * @param {Array} params.availableLoads - Available loads near destination
 * @returns {Promise<{recommendations: Array}>}
 */
export async function matchDeadhead({ driverDestination, truckSpecs, arrivalTime, availableLoads } = {}) {
  const url = `${getBaseUrl()}/match/deadhead`;

  const response = await fetch(url, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      driver_destination: driverDestination,
      truck_specs: truckSpecs,
      arrival_time: arrivalTime,
      available_loads: availableLoads,
    }),
    signal: AbortSignal.timeout(5000),
  });

  return handleResponse(response);
}

/**
 * Suggests additional pickups during an active trip.
 *
 * @param {object} params
 * @param {object} params.currentLocation - Current location {lat, lng}
 * @param {Array} params.remainingRoute - Remaining route waypoints [{lat, lng}]
 * @param {object} params.availableCapacity - Available truck capacity
 * @param {Array} params.nearbyLoads - Nearby active loads
 * @returns {Promise<{recommendations: Array}>}
 */
export async function optimiseMidTrip({ currentLocation, remainingRoute, availableCapacity, nearbyLoads } = {}) {
  const url = `${getBaseUrl()}/optimise/mid-trip`;

  const response = await fetch(url, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      current_location: currentLocation,
      remaining_route: remainingRoute,
      available_capacity: availableCapacity,
      nearby_loads: nearbyLoads,
    }),
    signal: AbortSignal.timeout(10000),
  });

  return handleResponse(response);
}
