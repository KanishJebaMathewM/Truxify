import logger from '../middleware/logger.js';
import { supabaseAdmin } from '../config/db.js';

export class OutboxPublisherWorker {
  /**
   * @param {object} [options={}]
   * @param {number} [options.pollIntervalMs=1000] - Polling interval in ms
   * @param {number} [options.batchSize=50] - Number of events per batch
   * @param {string} [options.workerId] - Unique ID for distributed worker instance
   */
  constructor(options = {}) {
    this.pollIntervalMs = options.pollIntervalMs || 1000;
    this.batchSize = options.batchSize || 50;
    this.workerId = options.workerId || `worker-${process.pid}-${Math.random().toString(36).substring(2, 7)}`;
    this.supabase = options.supabase || supabaseAdmin;

    this.subscribers = new Map(); // eventType -> Array<Function>
    this.isRunning = false;
    this.timer = null;
  }

  /**
   * Registers an event subscriber handler.
   * @param {string} eventType - Domain event type or '*' for wildcard
   * @param {Function} handler - Async handler function
   */
  subscribe(eventType, handler) {
    if (!this.subscribers.has(eventType)) {
      this.subscribers.set(eventType, []);
    }
    this.subscribers.get(eventType).push(handler);
  }

  /**
   * Claims a batch of pending events using PostgreSQL SKIP LOCKED.
   * @returns {Promise<Array<object>>}
   */
  async claimBatch() {
    try {
      const { data, error } = await this.supabase.rpc('claim_outbox_events_batch', {
        p_limit: this.batchSize,
        p_worker_id: this.workerId,
      });

      if (error) {
        // Fallback to direct query if RPC is unavailable
        const { data: fallbackData, error: fallbackError } = await this.supabase
          .from('outbox_events')
          .select('*')
          .in('status', ['PENDING', 'RETRY'])
          .order('created_at', { ascending: true })
          .limit(this.batchSize);

        if (fallbackError) {
          logger.error({ err: fallbackError }, '[OutboxPublisherWorker] Failed querying outbox events');
          return [];
        }
        return fallbackData || [];
      }

      return data || [];
    } catch (err) {
      logger.error({ err }, '[OutboxPublisherWorker] Error claiming outbox batch');
      return [];
    }
  }

  /**
   * Processes a single claimed outbox event.
   * 
   * @param {object} event
   */
  async processEvent(event) {
    const handlers = [
      ...(this.subscribers.get(event.event_type) || []),
      ...(this.subscribers.get('*') || []),
    ];

    if (handlers.length === 0) {
      // No handlers configured, mark as published
      await this._markStatus(event.id, 'PUBLISHED');
      return;
    }

    try {
      // Execute all subscribers concurrently
      await Promise.all(handlers.map((fn) => fn(event)));

      await this._markStatus(event.id, 'PUBLISHED');
      logger.debug({ eventId: event.id, eventType: event.event_type }, '[OutboxPublisherWorker] Event published successfully');
    } catch (err) {
      const retryCount = (event.retry_count || 0) + 1;
      const maxRetries = event.max_retries || 5;

      if (retryCount >= maxRetries) {
        // Move to Dead-Letter Queue (DLQ)
        logger.error(
          { err, eventId: event.id, retryCount, maxRetries },
          '[OutboxPublisherWorker] Event exhausted max retries; routing to DEAD_LETTER'
        );
        await this._markStatus(event.id, 'DEAD_LETTER', err.message);
      } else {
        // Schedule retry with exponential backoff delay
        const backoffMs = Math.min(300000, 1000 * Math.pow(2, retryCount));
        logger.warn(
          { eventId: event.id, retryCount, backoffMs },
          `[OutboxPublisherWorker] Handler failed; scheduling retry in ${backoffMs}ms`
        );
        await this._markStatus(event.id, 'RETRY', err.message);
      }
    }
  }

  /**
   * Updates the outbox event status.
   * @private
   */
  async _markStatus(eventId, status, errorMessage = null) {
    try {
      await this.supabase
        .from('outbox_events')
        .update({
          status,
          error_message: errorMessage,
          processed_at: status === 'PUBLISHED' || status === 'DEAD_LETTER' ? new Date().toISOString() : null,
        })
        .eq('id', eventId);
    } catch (err) {
      logger.error({ err, eventId, status }, '[OutboxPublisherWorker] Failed updating event status');
    }
  }

  /**
   * Performs one polling cycle.
   */
  async tick() {
    const events = await this.claimBatch();
    if (events.length > 0) {
      logger.info({ batchSize: events.length }, `[OutboxPublisherWorker] Processing ${events.length} outbox events`);
      for (const event of events) {
        await this.processEvent(event);
      }
    }
  }

  /**
   * Starts the background polling loop.
   */
  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    const loop = async () => {
      if (!this.isRunning) return;
      try {
        await this.tick();
      } catch (err) {
        logger.error({ err }, '[OutboxPublisherWorker] Uncaught exception in tick loop');
      } finally {
        if (this.isRunning) {
          this.timer = setTimeout(loop, this.pollIntervalMs);
        }
      }
    };

    this.timer = setTimeout(loop, this.pollIntervalMs);
    logger.info({ workerId: this.workerId, pollIntervalMs: this.pollIntervalMs }, '[OutboxPublisherWorker] Worker daemon started');
  }

  /**
   * Stops the background polling loop.
   */
  stop() {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    logger.info({ workerId: this.workerId }, '[OutboxPublisherWorker] Worker daemon stopped');
  }
}

export default OutboxPublisherWorker;
