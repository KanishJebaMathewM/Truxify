import { supabaseAdmin, redisClient } from '../../api/src/config/db.js';
import logger from '../../api/src/middleware/logger.js';
import {
  acquireLock,
  renewLock,
  releaseLock,
} from '../../api/src/lib/redisLock.js';

// A claim that stays in 'processing' longer than this (e.g. the consumer
// crashed mid-handler) is considered stale and can be re-claimed by the next
// delivery instead of being skipped forever.
const DEFAULT_STALE_PROCESSING_MS = 5 * 60 * 1000;
const LOCK_TTL_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 10_000;

class ProcessedEventRepository {
  constructor() {
    this.activeClaims = new Map();
  }

  _getLockKey(consumerGroup, topic, eventId) {
    return `kafka:claim:${consumerGroup || 'unknown'}:${topic}:${eventId}`;
  }

  _getClaimKey(consumerGroup, topic, eventId) {
    return `${consumerGroup || 'unknown'}:${topic}:${eventId}`;
  }

  /**
   * Checks whether the current replica holds an active in-flight claim
   * for the given event.
   */
  isClaimActive(topic, eventId, consumerGroup) {
    const claimKey = this._getClaimKey(consumerGroup, topic, eventId);
    return this.activeClaims.has(claimKey);
  }

  _startHeartbeat(claimKey, lockKey, lockValue, startedAt) {
    const existing = this.activeClaims.get(claimKey);
    if (existing?.timer) {
      clearInterval(existing.timer);
    }

    let timer = null;
    if (redisClient && lockValue) {
      let renewing = false;
      timer = setInterval(async () => {
        if (renewing) return;
        renewing = true;
        try {
          const renewed = await renewLock(lockKey, lockValue, LOCK_TTL_MS);
          if (!renewed) {
            logger.warn(`[ProcessedEventRepository] Lost Redis lock during heartbeat for ${lockKey}`);
          }
        } catch (err) {
          logger.error({ err }, `[ProcessedEventRepository] Error renewing Redis lock for ${lockKey}`);
        } finally {
          renewing = false;
        }
      }, HEARTBEAT_INTERVAL_MS);
      timer.unref?.();
    }

    this.activeClaims.set(claimKey, {
      startedAt,
      lockValue,
      timer,
      resourceKey: lockKey,
    });
  }

  /**
   * Atomically claim a Kafka message as being processed (two-phase).
   *
   * Inserts the row with status 'processing' (the upsert on (topic, event_id)
   * primary key makes concurrent or redelivered messages race safely — only
   * the first insert wins). A previously completed event is never re-claimed;
   * a previously failed event is re-claimed so it can be retried; an event
   * still 'processing' is only re-claimed once its claim is stale.
   *
   * @param {string} topic Kafka topic the event arrived on.
   * @param {string} eventId The event's natural idempotency key.
   * @param {string|null} orderId orders.id when derivable from the event.
   * @param {string} consumerGroup The consumer group claiming the event.
   * @param {{ staleProcessingAfterMs?: number }} [options]
   * @returns {Promise<boolean>} true when the event was claimed for
   *          (re)processing, false when it is already completed or actively
   *          being processed elsewhere.
   */
  async claimProcessing(topic, eventId, orderId = null, consumerGroup, { staleProcessingAfterMs = DEFAULT_STALE_PROCESSING_MS } = {}) {
    const lockKey = this._getLockKey(consumerGroup, topic, eventId);
    const claimKey = this._getClaimKey(consumerGroup, topic, eventId);

    // 1. Acquire Redis distributed lock across replicas if Redis is configured
    let lockValue = null;
    if (redisClient) {
      try {
        lockValue = await acquireLock(lockKey, LOCK_TTL_MS);
        if (!lockValue) {
          // Another replica is actively holding the lock and processing this event
          logger.info(
            `[ProcessedEventRepository] Event ${eventId} on ${topic} (group: ${consumerGroup}) is actively locked in Redis; skipping duplicate execution.`
          );
          return false;
        }
      } catch (err) {
        logger.warn(
          { err: err.message },
          `[ProcessedEventRepository] Redis lock acquisition error for ${lockKey}; falling back to DB fencing`
        );
      }
    }

    try {
      const claimStartedAt = new Date().toISOString();

      // 2. Attempt insert with status 'processing'
      const { data, error } = await supabaseAdmin
        .from('kafka_processed_events')
        .upsert({
          consumer_group: consumerGroup,
          topic,
          event_id: eventId,
          order_id: orderId || null,
          status: 'processing',
          started_at: claimStartedAt,
        }, {
          onConflict: 'consumer_group,topic,event_id',
          ignoreDuplicates: true,
        })
        .select('event_id');

      if (error) throw error;

      // Newly inserted -> claimed.
      if (Array.isArray(data) ? data.length > 0 : data !== null) {
        this._startHeartbeat(claimKey, lockKey, lockValue, claimStartedAt);
        return true;
      }

      // Row already exists — decide whether it can be re-claimed.
      let query = supabaseAdmin
        .from('kafka_processed_events')
        .select('status, started_at')
        .eq('topic', topic)
        .eq('event_id', eventId);

      if (consumerGroup !== undefined && consumerGroup !== null) {
        query = query.eq('consumer_group', consumerGroup);
      }

      const { data: existing, error: fetchError } = await query.maybeSingle();

      if (fetchError) throw fetchError;

      if (!existing || existing.status === 'completed') {
        if (redisClient && lockValue) {
          await releaseLock(lockKey, lockValue);
        }
        return false;
      }

      if (existing.status === 'processing') {
        const startedAt = existing.started_at ? new Date(existing.started_at).getTime() : 0;
        if (Date.now() - startedAt < staleProcessingAfterMs) {
          // Actively being processed (within stale window) — skip so
          // the side effect is never applied twice concurrently.
          if (redisClient && lockValue) {
            await releaseLock(lockKey, lockValue);
          }
          return false;
        }
      }

      // 'failed', or a stale 'processing' claim: take the claim back. The
      // guarded UPDATE means only one concurrent reclaimer wins.
      const reClaimStartedAt = new Date().toISOString();
      let updateQuery = supabaseAdmin
        .from('kafka_processed_events')
        .update({
          status: 'processing',
          started_at: reClaimStartedAt,
          order_id: orderId || null,
        })
        .eq('topic', topic)
        .eq('event_id', eventId)
        .eq('status', existing.status);

      if (consumerGroup !== undefined && consumerGroup !== null) {
        updateQuery = updateQuery.eq('consumer_group', consumerGroup);
      }

      const { data: updated, error: updateError } = await updateQuery.select('event_id');

      if (updateError) throw updateError;

      const isUpdated = Array.isArray(updated) ? updated.length > 0 : updated !== null;
      if (isUpdated) {
        this._startHeartbeat(claimKey, lockKey, lockValue, reClaimStartedAt);
        return true;
      }

      if (redisClient && lockValue) {
        try {
          await releaseLock(lockKey, lockValue);
        } catch (_) {}
      }
      return false;
    } catch (error) {
      if (redisClient && lockValue) {
        try {
          await releaseLock(lockKey, lockValue);
        } catch (_) {}
      }
      logger.error(`Failed to claim processed event ${eventId} on ${topic} (group ${consumerGroup}):`, error);
      throw error;
    }
  }

  /**
   * Mark a claimed event as fully processed after its handlers succeeded.
   * Guards on started_at fencing token to avoid overwriting newer claims.
   */
  async markCompleted(topic, eventId, consumerGroup, options = {}) {
    const claimKey = this._getClaimKey(consumerGroup, topic, eventId);
    const activeClaim = this.activeClaims.get(claimKey);

    if (activeClaim?.timer) {
      clearInterval(activeClaim.timer);
    }

    const startedAt = options.startedAt || activeClaim?.startedAt;
    const lockValue = options.lockValue || activeClaim?.lockValue;
    const resourceKey = activeClaim?.resourceKey || this._getLockKey(consumerGroup, topic, eventId);

    try {
      let query = supabaseAdmin
        .from('kafka_processed_events')
        .update({ status: 'completed' })
        .eq('topic', topic)
        .eq('event_id', eventId)
        .eq('status', 'processing');

      if (consumerGroup !== undefined && consumerGroup !== null) {
        query = query.eq('consumer_group', consumerGroup);
      }

      // Fencing token: verify the claim's started_at timestamp hasn't been superseded
      if (startedAt) {
        query = query.eq('started_at', startedAt);
      }

      const { data, error } = await query.select('event_id');
      if (error) throw error;

      const updated = Array.isArray(data) ? data.length > 0 : data !== null;
      if (!updated) {
        logger.warn(
          `[ProcessedEventRepository] markCompleted did not update event ${eventId} on ${topic} ` +
          `(group ${consumerGroup}): claim was lost, expired, or superseded.`
        );
      }
      return updated;
    } catch (error) {
      logger.error(`Failed to mark processed event ${eventId} on ${topic} as completed:`, error);
      throw error;
    } finally {
      if (redisClient && lockValue) {
        try {
          await releaseLock(resourceKey, lockValue);
        } catch (_) {}
      }
      this.activeClaims.delete(claimKey);
    }
  }

  /**
   * Mark a claimed event as failed after a handler threw, so a later
   * delivery can re-claim and retry it.
   * Guards on started_at fencing token to avoid overwriting newer claims.
   */
  async markFailed(topic, eventId, consumerGroup, options = {}) {
    const claimKey = this._getClaimKey(consumerGroup, topic, eventId);
    const activeClaim = this.activeClaims.get(claimKey);

    if (activeClaim?.timer) {
      clearInterval(activeClaim.timer);
    }

    const startedAt = options.startedAt || activeClaim?.startedAt;
    const lockValue = options.lockValue || activeClaim?.lockValue;
    const resourceKey = activeClaim?.resourceKey || this._getLockKey(consumerGroup, topic, eventId);

    try {
      let query = supabaseAdmin
        .from('kafka_processed_events')
        .update({ status: 'failed' })
        .eq('topic', topic)
        .eq('event_id', eventId)
        .eq('status', 'processing');

      if (consumerGroup !== undefined && consumerGroup !== null) {
        query = query.eq('consumer_group', consumerGroup);
      }

      // Fencing token: verify the claim's started_at timestamp hasn't been superseded
      if (startedAt) {
        query = query.eq('started_at', startedAt);
      }

      const { data, error } = await query.select('event_id');
      if (error) throw error;

      const updated = Array.isArray(data) ? data.length > 0 : data !== null;
      if (!updated) {
        logger.warn(
          `[ProcessedEventRepository] markFailed did not update event ${eventId} on ${topic} ` +
          `(group ${consumerGroup}): claim was lost, expired, or superseded.`
        );
      }
      return updated;
    } catch (error) {
      logger.error(`Failed to mark processed event ${eventId} on ${topic} as failed:`, error);
      throw error;
    } finally {
      if (redisClient && lockValue) {
        try {
          await releaseLock(resourceKey, lockValue);
        } catch (_) {}
      }
      this.activeClaims.delete(claimKey);
    }
  }

  /**
   * Look up the current processing status of an event in kafka_processed_events.
   *
   * @param {string} topic
   * @param {string} eventId
   * @param {string} [consumerGroup]
   * @returns {Promise<'processing'|'completed'|'failed'|null>} Current status, or null if no claim exists.
   */
  async getStatus(topic, eventId, consumerGroup) {
    try {
      let query = supabaseAdmin
        .from('kafka_processed_events')
        .select('status')
        .eq('topic', topic)
        .eq('event_id', eventId);

      if (consumerGroup !== undefined && consumerGroup !== null) {
        query = query.eq('consumer_group', consumerGroup);
      }

      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      return data?.status || null;
    } catch (error) {
      logger.error(`Failed to get status for event ${eventId} on ${topic} (group: ${consumerGroup}):`, error);
      throw error;
    }
  }
}

export default new ProcessedEventRepository();

