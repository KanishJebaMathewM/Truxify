import logger from '../../middleware/logger.js';
import { admitTrajectoryPoint, boundedInteger } from './trajectoryObservation.js';

export class BatchTrajectoryPersistence {
  #client;
  #queue = [];
  #flight = null;
  #stopFlight = null;
  #timer = null;
  #running = false;
  #epoch = 0;
  #interval;
  #batchSize;
  #capacity;
  #timeout;

  constructor(options = {}) {
    this.#interval = boundedInteger(options.flushIntervalMs, 10000, 'flush interval', 3600000);
    this.#batchSize = boundedInteger(options.maxBatchSize, 50, 'batch size', 1000);
    this.#capacity = boundedInteger(options.maxPendingPoints, 10000, 'pending capacity', 100000);
    this.#timeout = boundedInteger(options.flushTimeoutMs, 10000, 'flush timeout', 60000);
    if (this.#capacity < this.#batchSize) throw new RangeError('pending capacity must accommodate one batch');
    this.#client = options.supabase ?? null;
    if (this.#client !== null && typeof this.#client.from !== 'function') throw new TypeError('Supabase client must expose from()');
    this.startAutoFlush();
  }
  get flushIntervalMs() { return this.#interval; }
  get maxBatchSize() { return this.#batchSize; }
  get maxPendingPoints() { return this.#capacity; }
  get pendingBuffer() { return this.#queue.map(row => ({ ...row })); }
  get flushTimer() { return this.#timer; }
  get supabase() { return this.#client; }

  addPoint(point) {
    if (!this.#running || this.#stopFlight) throw new Error('trajectory writer admission is stopped');
    const row = admitTrajectoryPoint(point);
    if (this.#queue.length >= this.#capacity) throw new RangeError('trajectory pending capacity reached');
    this.#queue.push(row);
    if (this.#queue.length >= this.#batchSize) {
      this.flush().catch(error => logger.error({ err: error }, '[BatchTrajectoryPersistence] Threshold flush failed'));
    }
  }

  async #persist(batch) {
    const signal = AbortSignal.timeout(this.#timeout);
    try {
      // Default API bootstrap is loaded only when an actual default-client write is requested.
      if (!this.#client) this.#client = (await import('../../config/db.js')).supabase;
      if (!this.#client || typeof this.#client.from !== 'function') throw new Error('Supabase client unavailable');
      const response = await this.#client.from('trip_gps_trajectories').insert(batch).abortSignal(signal);
      if (response?.error !== null || !Number.isInteger(response?.status) || response.status < 200 || response.status >= 300) {
        logger.warn({ count: batch.length, status: response?.status }, '[BatchTrajectoryPersistence] Insert unacknowledged; retaining owned batch');
        return 0;
      }
      // Single-flight ownership keeps the exact admitted prefix present through acknowledgment.
      this.#queue.splice(0, batch.length);
      return batch.length;
    } catch (error) {
      logger.warn({ err: error, count: batch.length }, '[BatchTrajectoryPersistence] Insert failed; retaining owned batch');
      return 0;
    }
  }

  /** One request owns its queued prefix until native acknowledgment or complete failure. */
  flush() {
    if (this.#flight) return this.#flight;
    if (!this.#queue.length) return Promise.resolve(0);
    const batch = this.#queue.slice(0, this.#batchSize);
    const epoch = this.#epoch;
    let acknowledged = 0;
    const receipt = this.#persist(batch).then(count => { acknowledged = count; return count; }).finally(() => {
      if (this.#flight === receipt) this.#flight = null;
      if (acknowledged && this.#running && !this.#stopFlight && this.#epoch === epoch && this.#queue.length >= this.#batchSize) {
        queueMicrotask(() => {
          if (this.#running && !this.#stopFlight && this.#epoch === epoch) this.flush().catch(error => logger.error({ err: error }, '[BatchTrajectoryPersistence] Follow-up flush failed'));
        });
      }
    });
    this.#flight = receipt;
    return receipt;
  }

  startAutoFlush() {
    if (this.#stopFlight) throw new Error('shutdown drain must settle before restart');
    if (this.#running) return;
    this.#running = true;
    const epoch = ++this.#epoch;
    this.#timer = setInterval(() => {
      if (this.#running && this.#epoch === epoch) this.flush().catch(error => logger.error({ err: error }, '[BatchTrajectoryPersistence] Interval flush failed'));
    }, this.#interval);
    this.#timer.unref?.();
  }

  /** Close admission, retain an admitted request, then drain until acknowledgment or first failure. */
  stop() {
    if (this.#stopFlight) return this.#stopFlight;
    this.#running = false;
    this.#epoch += 1;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    const receipt = (async () => {
      let acknowledged = 0;
      while (this.#flight || this.#queue.length) {
        const count = await this.flush();
        acknowledged += count;
        if (!count) break;
      }
      return { success: this.#queue.length === 0, acknowledged, pending: this.#queue.length };
    })().finally(() => { if (this.#stopFlight === receipt) this.#stopFlight = null; });
    this.#stopFlight = receipt;
    return receipt;
  }
}
export default BatchTrajectoryPersistence;
