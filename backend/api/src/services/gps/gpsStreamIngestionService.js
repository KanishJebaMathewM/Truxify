import { redisClient } from '../../config/db.js';
import logger from '../../middleware/logger.js';
import { KalmanFilter2D } from './kalmanFilter.js';
import { GeofenceEvaluator } from './geofenceEvaluator.js';

export const GPS_STREAM_KEY = 'gps:stream:trips';
export const GPS_STREAM_GROUP = 'gps_workers_group';

export class GpsStreamIngestionService {
  constructor(options = {}) {
    this.streamKey = options.streamKey || GPS_STREAM_KEY;
    this.geofenceEvaluator = options.geofenceEvaluator || new GeofenceEvaluator();
    this.kalmanFilters = new Map(); // tripId -> KalmanFilter2D
  }

  /**
   * Initializes Redis stream consumer group.
   */
  async initStreamGroup() {
    if (redisClient && typeof redisClient.xgroup === 'function') {
      try {
        await redisClient.xgroup('CREATE', this.streamKey, GPS_STREAM_GROUP, '$', 'MKSTREAM');
        logger.info('[GpsStreamIngestionService] Initialized Redis Stream consumer group');
      } catch (err) {
        if (!err.message?.includes('BUSYGROUP')) {
          logger.warn({ err: err.message }, '[GpsStreamIngestionService] Consumer group init warning');
        }
      }
    }
  }

  /**
   * Ingests a raw GPS ping, applies Kalman filtering, and appends to Redis Stream.
   * 
   * @param {object} ping - { tripId, driverId, lat, lng, speed, heading, accuracy, timestamp }
   * @returns {Promise<{success: boolean, smoothed: object, geofenceEvents: Array}>}
   */
  async ingestPing(ping) {
    const {
      tripId,
      driverId,
      lat,
      lng,
      speed = 0,
      heading = 0,
      accuracy = 5.0,
      timestamp = Date.now(),
    } = ping;

    if (!tripId || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new Error('Invalid GPS ping: missing tripId or coordinates');
    }

    // 1. Apply 2D Kinematic Kalman Filter for Coordinate Smoothing
    if (!this.kalmanFilters.has(tripId)) {
      this.kalmanFilters.set(tripId, new KalmanFilter2D());
    }
    const filter = this.kalmanFilters.get(tripId);
    const smoothed = filter.update(lat, lng, timestamp, accuracy);

    // 2. Real-Time Geofence Boundary Check
    const geofenceEvents = this.geofenceEvaluator.evaluateLocation(tripId, smoothed.lat, smoothed.lng);

    const payload = {
      tripId,
      driverId: driverId || 'unknown',
      rawLat: lat.toString(),
      rawLng: lng.toString(),
      lat: smoothed.lat.toString(),
      lng: smoothed.lng.toString(),
      speed: (smoothed.speedMps || speed).toString(),
      heading: heading.toString(),
      accuracy: accuracy.toString(),
      timestamp: timestamp.toString(),
      geofenceEvents: JSON.stringify(geofenceEvents),
    };

    // 3. Fast Ingestion into Redis Stream (XADD)
    if (redisClient && typeof redisClient.xadd === 'function') {
      try {
        const streamEntries = Object.entries(payload).flat();
        await redisClient.xadd(this.streamKey, '*', ...streamEntries);
      } catch (err) {
        logger.warn({ err: err.message, tripId }, '[GpsStreamIngestionService] Redis XADD failed; proceeding locally');
      }
    }

    return {
      success: true,
      tripId,
      smoothed: {
        lat: smoothed.lat,
        lng: smoothed.lng,
        speedMps: smoothed.speedMps,
      },
      geofenceEvents,
      timestamp: new Date(timestamp).toISOString(),
    };
  }
}

export default GpsStreamIngestionService;
