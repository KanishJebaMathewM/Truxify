// backend/api/src/services/navigation/routeDeviationService.js

import logger from '../../middleware/logger.js';
import { getCacheItem, setCacheItem } from '../../cache/CacheManager.js';

// Configurable thresholds (meters)
const DEVIATION_CONFIG = {
  WARNING_THRESHOLD: 300,       // 300m - 750m
  SIGNIFICANT_THRESHOLD: 750,   // 750m - 1.5km
  CRITICAL_THRESHOLD: 1500,     // > 1.5km
  COOLDOWN_SECONDS: 60          // Debounce window
};

/**
 * Calculates minimum distance from a point to a polyline route using Haversine approximation.
 */
function calculateDistanceFromRoute(currentLat, currentLon, routePolyline) {
  // Simplified point-to-segment minimum distance calculation
  let minDistanceMeters = Infinity;

  for (let i = 0; i < routePolyline.length; i++) {
    const [lat, lon] = routePolyline[i];
    const dist = getHaversineDistanceMeters(currentLat, currentLon, lat, lon);
    if (dist < minDistanceMeters) {
      minDistanceMeters = dist;
    }
  }
  return minDistanceMeters;
}

function getHaversineDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Evaluates GPS update against planned route and checks debouncing cooldown.
 */
export async function evaluateRouteDeviation(tripId, driverId, currentCoords, plannedRoute) {
  if (!tripId || !currentCoords || !plannedRoute || plannedRoute.length === 0) {
    return { status: 'ignored', reason: 'Invalid input parameters' };
  }

  const [lat, lon] = currentCoords;
  const distanceMeters = calculateDistanceFromRoute(lat, lon, plannedRoute);

  // Classify severity
  let severity = 'normal';
  if (distanceMeters >= DEVIATION_CONFIG.CRITICAL_THRESHOLD) {
    severity = 'critical';
  } else if (distanceMeters >= DEVIATION_CONFIG.SIGNIFICANT_THRESHOLD) {
    severity = 'significant';
  } else if (distanceMeters >= DEVIATION_CONFIG.WARNING_THRESHOLD) {
    severity = 'warning';
  }

  // Normal routes do not trigger deviation events
  if (severity === 'normal') {
    return { severity, distanceMeters, triggered: false };
  }

  // Check cooldown/debouncing cache
  const cooldownKey = `trip:deviation:cooldown:${tripId}`;
  const lastTriggered = await getCacheItem(cooldownKey);

  if (lastTriggered) {
    return { 
      severity, 
      distanceMeters, 
      triggered: false, 
      reason: 'Suppressed by cooldown window' 
    };
  }

  // Set cooldown lock
  await setCacheItem(cooldownKey, Date.now(), DEVIATION_CONFIG.COOLDOWN_SECONDS);

  // Construct structured route_deviation event
  const deviationEvent = {
    eventType: 'route_deviation',
    tripId,
    driverId,
    timestamp: new Date().toISOString(),
    gpsCoordinates: { latitude: lat, longitude: lon },
    deviationDistanceMeters: Math.round(distanceMeters),
    severity
  };

  logger.warn('Route deviation detected for active trip', deviationEvent);

  // Return event for trip history persistence and dispatcher notification
  return {
    severity,
    distanceMeters,
    triggered: true,
    event: deviationEvent
  };
}
