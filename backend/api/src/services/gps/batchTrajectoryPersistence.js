import logger from '../../middleware/logger.js';
import { supabase } from '../../config/db.js';

export class BatchTrajectoryPersistence {
  /**
   * @param {object} [options={}]
   * @param {number} [options.flushIntervalMs=10000] - Flush every 10 seconds
   * @param {number} [options.maxBatchSize=50] - Flush when batch reaches 50 points
   */
  constructor(options = {}) {
    this.flushIntervalMs = options.flushIntervalMs || 10000;
    this.maxBatchSize = options.maxBatchSize || 50;
    this.supabase = options.supabase || supabase;

    this.pendingBuffer = [];
    this.flushTimer = null;

    this.startAutoFlush();
  }

  /**
   * Adds a smoothed GPS point to the persistence batch queue.
   * 
   * @param {object} point - { tripId, driverId, lat, lng, speedMps, heading, roadName, timestamp }
   */
  addPoint(point) {
    this.pendingBuffer.push({
      trip_id: point.tripId,
      driver_id: point.driverId,
      lat: point.lat,
      lng: point.lng,
      speed_mps: point.speedMps || 0,
      heading: point.heading || 0,
      road_name: point.roadName || null,
      recorded_at: point.timestamp ? new Date(point.timestamp).toISOString() : new Date().toISOString(),
    });

    if (this.pendingBuffer.length >= this.maxBatchSize) {
      this.flush();
    }
  }

  /**
   * Flushes all pending trajectory points to PostgreSQL in a single bulk insert.
   * 
   * @returns {Promise<number>} Number of points persisted
   */
  async flush() {
    if (this.pendingBuffer.length === 0) {
      return 0;
    }

    const batchToInsert = [...this.pendingBuffer];
    this.pendingBuffer = [];

    try {
      if (this.supabase && typeof this.supabase.from === 'function') {
        const { error } = await this.supabase
          .from('trip_gps_trajectories')
          .insert(batchToInsert);

        if (error) {
          logger.warn({ error: error.message, count: batchToInsert.length }, '[BatchTrajectoryPersistence] Bulk insert warning');
        } else {
          logger.debug({ count: batchToInsert.length }, '[BatchTrajectoryPersistence] Flushed trajectory micro-batch');
        }
      }
      return batchToInsert.length;
    } catch (err) {
      logger.error({ err, count: batchToInsert.length }, '[BatchTrajectoryPersistence] Failed flushing trajectory batch');
      return 0;
    }
  }

  /**
   * Starts periodic background batch flush timer.
   */
  startAutoFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      this.flush().catch((err) => {
        logger.error({ err }, '[BatchTrajectoryPersistence] Auto-flush error');
      });
    }, this.flushIntervalMs);
  }

  /**
   * Stops auto-flush timer and flushes any remaining points.
   */
  async stop() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }
}

export default BatchTrajectoryPersistence;
