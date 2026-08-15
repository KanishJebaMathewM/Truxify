import { supabaseAdmin } from '../../config/db.js';
import logger from '../../middleware/logger.js';
import crypto from 'crypto';

/**
 * Transactional Outbox Service
 * Inserts durable event records atomically with order mutations.
 * A separate relay picks them up and publishes to Kafka/event bus.
 */
export class OutboxService {
  /**
   * Write an outbox event. Call this AFTER a successful order DB write
   * within the same logical operation so the event is always durable.
   */
  async writeEvent({ aggregateId, aggregateType = 'order', eventType, payload }) {
    if (!aggregateId || !eventType) {
      logger.warn('[OutboxService] Skipping outbox write — missing aggregateId or eventType');
      return null;
    }

    const eventId = crypto.randomUUID();
    const { data, error } = await supabaseAdmin
      .from('outbox_events')
      .insert({
        id: eventId,
        aggregate_id: aggregateId,
        aggregate_type: aggregateType,
        event_type: eventType,
        payload: payload ?? {},
        status: 'pending',
        created_at: new Date().toISOString(),
        retry_count: 0,
      })
      .select('id')
      .single();

    if (error) {
      // Surface the failure so the caller can decide how to handle a
      // non-atomic write (the order mutation may already have committed).
      logger.error('[OutboxService] Failed to write outbox event:', error.message, { aggregateId, eventType });
      throw error;
    }

    logger.info('[OutboxService] Outbox event written:', { eventId, aggregateId, eventType });
    return data?.id ?? null;
  }

  /**
   * Atomically claim a batch of pending outbox events for this worker using the
   * claim_outbox_batch SECURITY DEFINER RPC. The RPC uses
   * SELECT ... FOR UPDATE SKIP LOCKED so multiple API replicas can never claim
   * the same row: each replica only publishes the rows it owns, which is what
   * prevents duplicate Kafka events per replica (issue #14680).
   */
  async claimBatch({ workerId, batchSize = 50, leaseMs = 5 * 60 * 1000 } = {}) {
    if (!workerId) {
      logger.warn('[OutboxService] Skipping claim — missing workerId');
      return [];
    }

    const { data, error } = await supabaseAdmin.rpc('claim_outbox_batch', {
      p_worker_id: workerId,
      p_batch_size: batchSize,
      p_lease_seconds: Math.max(1, Math.floor(leaseMs / 1000)),
    });

    if (error) {
      logger.error('[OutboxService] Failed to claim outbox batch:', error.message);
      return [];
    }
    return data ?? [];
  }

  /**
   * Reset 'publishing' rows whose lease expired (crashed worker) back to
   * 'pending' so any replica can reclaim them.
   */
  async reclaimExpiredClaims({ leaseBufferMs = 60 * 1000, batchSize = 100 } = {}) {
    const { error } = await supabaseAdmin.rpc('reclaim_outbox_batch', {
      p_lease_buffer_seconds: Math.max(0, Math.floor(leaseBufferMs / 1000)),
      p_batch_size: batchSize,
    });

    if (error) {
      logger.warn('[OutboxService] Failed to reclaim expired outbox claims:', error.message);
    }
  }

  /**
   * Mark a claimed event as published after successful Kafka delivery.
   *
   * Fenced on ownership: only the worker that currently owns the 'publishing'
   * row (matching claimed_by) may resolve it. If another replica reclaimed the
   * row after lease expiry, the update matches zero rows and we report loss of
   * ownership so the worker does not double-count the delivery.
   *
   * @returns {Promise<boolean>} true if the row was marked published by this worker
   */
  async markPublished(eventId, workerId) {
    if (!eventId || !workerId) {
      logger.warn('[OutboxService] Skipping markPublished — missing eventId or workerId');
      return false;
    }

    const { data, error } = await supabaseAdmin
      .from('outbox_events')
      .update({ status: 'published', published_at: new Date().toISOString() })
      .eq('id', eventId)
      .eq('status', 'publishing')
      .eq('claimed_by', workerId)
      .select('id');

    if (error) {
      logger.error('[OutboxService] Failed to mark event published:', error.message, { eventId });
      throw error;
    }
    return Boolean(data && data.length > 0);
  }

  /**
   * Mark an event as failed and increment retry_count.
   *
   * The new retry_count is computed in JS: the previous implementation
   * assigned an unawaited `supabase.rpc('increment', ...)` Promise to the
   * column, so the counter never advanced and dead-lettering never triggered.
   */
  async markFailed(eventId, workerId, errorMessage) {
    if (!eventId || !workerId) {
      logger.warn('[OutboxService] Skipping markFailed — missing eventId or workerId');
      return false;
    }

    const { data: current, error: fetchError } = await supabaseAdmin
      .from('outbox_events')
      .select('retry_count')
      .eq('id', eventId)
      .eq('status', 'publishing')
      .eq('claimed_by', workerId)
      .single();

    if (fetchError) {
      logger.warn('[OutboxService] Failed to read retry_count (or lost claim ownership):', fetchError.message, { eventId });
    }

    const currentRetryCount = Number.isFinite(current?.retry_count) ? current.retry_count : 0;

    const { error } = await supabaseAdmin
      .from('outbox_events')
      .update({
        status: 'failed',
        last_error: String(errorMessage).slice(0, 1000),
        retry_count: currentRetryCount + 1,
        last_attempted_at: new Date().toISOString(),
      })
      .eq('id', eventId)
      .eq('status', 'publishing')
      .eq('claimed_by', workerId);

    if (error) {
      logger.error('[OutboxService] Failed to mark event failed:', error.message, { eventId });
      return false;
    }
    return true;
  }

  /**
   * Reset failed events back to pending for retry (up to maxRetries).
   * Clears any stale claim metadata so the row can be re-claimed.
   */
  async requeueFailedEvents(maxRetries = 5) {
    const { error } = await supabaseAdmin
      .from('outbox_events')
      .update({
        status: 'pending',
        claimed_by: null,
        claimed_at: null,
        lease_expires_at: null,
      })
      .eq('status', 'failed')
      .lt('retry_count', maxRetries);

    if (error) {
      logger.error('[OutboxService] Failed to requeue failed events:', error.message);
    }
  }
}

export const outboxService = new OutboxService();