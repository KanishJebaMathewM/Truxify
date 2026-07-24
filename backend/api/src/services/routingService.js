import axios from 'axios';
import logger from '../middleware/logger.js';

/**
 * Optimizes the order of waypoints for a route using the OSRM Trip API.
 * @param {Object} start - { lat, lng, address }
 * @param {Object} end - { lat, lng, address }
 * @param {Array} waypoints - Array of { lat, lng, address }
 * @returns {Promise<Array>} The optimized array of waypoints
 */
export async function optimizeWaypoints(start, end, waypoints) {
  if (!waypoints || waypoints.length === 0) return [];
  if (waypoints.length === 1) return waypoints; // Nothing to reorder

  try {
    // Construct coordinate string: OSRM uses lon,lat
    const coords = [
      `${start.lng},${start.lat}`,
      ...waypoints.map(wp => `${wp.lng},${wp.lat}`),
      `${end.lng},${end.lat}`
    ].join(';');

    // Use OSRM trip API with configurable URL
    // roundtrip=false, source=first, destination=last
    const OSRM_URL = process.env.OSRM_URL || 'http://localhost:5000';
    const url = `${OSRM_URL}/trip/v1/driving/${coords}?roundtrip=false&source=first&destination=last`;
    
    const response = await axios.get(url, { timeout: 10000 });
    
    if (response.data.code !== 'Ok') {
      logger.warn(`OSRM Trip API failed with code: ${response.data.code}`);
      return waypoints; // Fallback to original order
    }

    const waypointsResult = response.data.waypoints;
    if (!waypointsResult || waypointsResult.length === 0) {
      return waypoints;
    }

    // OSRM returns waypoints in the order they were provided, but with a `waypoint_index` 
    // indicating their optimal position in the trip.
    // Index 0 is the start, Index N is the end.
    
    const optimizedWaypoints = new Array(waypoints.length);
    
    // Original array order: [Start, WP1, WP2, ..., End]
    for (let i = 1; i <= waypoints.length; i++) {
      const osrmWp = waypointsResult[i];
      // Subtract 1 from waypoint_index because index 0 is the start point.
      const newIndex = osrmWp.waypoint_index - 1;
      optimizedWaypoints[newIndex] = waypoints[i - 1];
    }

    return optimizedWaypoints;
  } catch (err) {
    logger.error('Failed to optimize route with OSRM:', err.message);
    return waypoints; // Fallback to original order on failure
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
