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

    // Use OSRM public trip API
    // roundtrip=false, source=first, destination=last
    const url = `http://router.project-osrm.org/trip/v1/driving/${coords}?roundtrip=false&source=first&destination=last`;
    
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
