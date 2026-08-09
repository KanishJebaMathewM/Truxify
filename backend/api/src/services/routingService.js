import axios from 'axios';
import logger from '../middleware/logger.js';

import { predictWorkZoneDelays, generateBypassWaypoint } from './workZoneService.js';

/**
 * Optimizes the order of waypoints for a route using the OSRM Trip API.
 * Integrates predictive work-zone delay logic to dynamically reroute.
 * @param {Object} start - { lat, lng, address }
 * @param {Object} end - { lat, lng, address }
 * @param {Array} waypoints - Array of { lat, lng, address }
 * @param {string} [departureDate] - YYYY-MM-DD
 * @param {string} [departureTime] - HH:MM
 * @returns {Promise<Array>} The optimized array of waypoints (including any bypass waypoints)
 */
export async function optimizeWaypoints(start, end, waypoints, departureDate, departureTime) {
  let effectiveWaypoints = Array.isArray(waypoints) ? [...waypoints] : [];

  try {
    const normalizeCoordinatePoint = (point, label) => {
      const lat = Number(point?.lat);
      const lng = Number(point?.lng);

      if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
        throw new Error(`Invalid latitude for ${label}`);
      }

      if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
        throw new Error(`Invalid longitude for ${label}`);
      }

      return { lat, lng, address: point.address || 'Unknown' };
    };

    const normalizedStart = normalizeCoordinatePoint(start, 'start');
    const normalizedEnd = normalizeCoordinatePoint(end, 'end');
    
    // Check for predictive work-zone delays
    if (departureDate && departureTime) {
      const { hasSevereDelay, problematicPoint } = await predictWorkZoneDelays(
        normalizedStart,
        normalizedEnd,
        effectiveWaypoints,
        departureDate,
        departureTime
      );

      if (hasSevereDelay && problematicPoint) {
        const bypassWaypoint = generateBypassWaypoint(problematicPoint);
        if (bypassWaypoint) {
          effectiveWaypoints.push(bypassWaypoint);
        }
      }
    }

    if (effectiveWaypoints.length === 0) return [];
    if (effectiveWaypoints.length === 1) return effectiveWaypoints; // Nothing to reorder (except if it was just the bypass)

    const normalizedWaypoints = effectiveWaypoints.map((wp, index) =>
      normalizeCoordinatePoint(wp, `waypoint ${index + 1}`)
    );

    // Construct coordinate string: OSRM uses lon,lat
    const coords = [
      `${normalizedStart.lng},${normalizedStart.lat}`,
      ...normalizedWaypoints.map(wp => `${wp.lng},${wp.lat}`),
      `${normalizedEnd.lng},${normalizedEnd.lat}`
    ].join(';');

    // Use OSRM trip API with configurable URL
    // roundtrip=false, source=first, destination=last
    const OSRM_URL = process.env.OSRM_URL || 'http://localhost:5000';
    const url = `${OSRM_URL}/trip/v1/driving/${coords}?roundtrip=false&source=first&destination=last`;
    
    const response = await axios.get(url, { timeout: 10000 });
    
    if (response.data.code !== 'Ok') {
      logger.warn(`OSRM Trip API failed with code: ${response.data.code}`);
      return effectiveWaypoints; // Fallback to original order
    }

    const waypointsResult = response.data.waypoints;
    if (!waypointsResult || waypointsResult.length === 0) {
      return effectiveWaypoints;
    }

    // OSRM returns waypoints in the order they were provided, but with a `waypoint_index` 
    // indicating their optimal position in the trip.
    // Index 0 is the start, Index N is the end.
    
    const optimizedWaypoints = new Array(effectiveWaypoints.length);

    // waypointsResult is in input order: [Start, WP1, WP2, ..., End].
    // Each waypoint's `waypoint_index` is its position in the optimized trip
    // (0 = start, effectiveWaypoints.length + 1 = end), so subtract 1 for the middle stops.
    for (let i = 1; i <= effectiveWaypoints.length; i++) {
      const osrmWp = waypointsResult[i];
      const optimizedIndex = osrmWp.waypoint_index - 1;
      if (optimizedIndex >= 0 && optimizedIndex < effectiveWaypoints.length) {
        optimizedWaypoints[optimizedIndex] = effectiveWaypoints[i - 1];
      }
    }

    // Filter out any undefined slots just in case
    return optimizedWaypoints.filter(Boolean);
  } catch (err) {
    logger.error('Failed to optimize route with OSRM:', err.message);
    return effectiveWaypoints; // Fallback to original order on failure
  }
}

export function getHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

/**
 * Optimizes an LTL route (multiple pickups and dropoffs) using a Greedy Nearest Neighbor approach.
 * Respects precedence constraints (pickup must happen before dropoff).
 * 
 * @param {number} driverLat 
 * @param {number} driverLng 
 * @param {Array} tasks - Array of { id, orderId, type: 'pickup'|'dropoff', lat, lng, address }
 * @returns {Array} Optimized array of tasks
 */
export function optimizeLtlRoute(driverLat, driverLng, tasks) {
  if (!tasks || tasks.length <= 1) return tasks;

  const visited = new Set();
  const sortedTasks = [];
  
  // Track which orders have had their pickup completed (either previously or in this route)
  const pickedUpOrders = new Set();
  
  // Initialize with orders that don't have a pickup in the tasks list (already picked up)
  const pickupOrderIds = new Set(tasks.filter(t => t.type === 'pickup').map(t => t.orderId));
  tasks.forEach(t => {
    if (t.type === 'dropoff' && !pickupOrderIds.has(t.orderId)) {
      pickedUpOrders.add(t.orderId);
    }
  });

  let currentLat = driverLat;
  let currentLng = driverLng;

  while (sortedTasks.length < tasks.length) {
    let nearestTask = null;
    let minDistance = Infinity;

    for (const task of tasks) {
      if (visited.has(task.id)) continue;
      
      // Enforce precedence: cannot visit dropoff if pickup is not completed
      if (task.type === 'dropoff' && !pickedUpOrders.has(task.orderId)) {
        continue;
      }

      const dist = getHaversineDistance(currentLat, currentLng, task.lat, task.lng);
      if (dist < minDistance) {
        minDistance = dist;
        nearestTask = task;
      }
    }

    if (!nearestTask) {
      break;
    }

    visited.add(nearestTask.id);
    sortedTasks.push(nearestTask);
    currentLat = nearestTask.lat;
    currentLng = nearestTask.lng;

    if (nearestTask.type === 'pickup') {
      pickedUpOrders.add(nearestTask.orderId);
    }
  }

  // Append any remaining tasks that couldn't be routed (failsafe)
  for (const task of tasks) {
    if (!visited.has(task.id)) {
      sortedTasks.push(task);
    }
  }

  return sortedTasks;
}
