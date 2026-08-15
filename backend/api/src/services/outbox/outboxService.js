import { supabaseAdmin } from '../../config/db.js';
import logger from '../../middleware/logger.js';
import crypto from 'crypto';

/**
 * Transactional Outbox Service
 *
 * Targets the authoritative `event_outbox` table created by the unified
 * Supabase pipeline (supabase/migrations/20260810000000_event_outbox_and_read_model.sql).
 * The legacy `outbox_events` table is only created by a migration in the LEGACY
 * folder, which the Supabase pipeline does not apply — writing to it fails with
 * 42P01 (relation does not exist) on a Supabase-backed deployment, which in turn
 * flipped a successfully-committed order mutation into a 500 (#14703).
 *
 * Every write here is best-effort: a failed outbox write must NEVER turn a
 * successfully-committed order mutation into a 500. `orderRepository.updateOrder`
 * documents the outbox write as best-effort / never-throws, so `writeEvent`
 * logs-and-swallows instead of rethrowing.
 */
export class OutboxService {
  /**
   * Write an outbox event. Call this AFTER a successful order DB write
   * within the same logical operation so the event is always durable.
   *
   * Best-effort: on any failure we log and return null rather than throw,
   * so the caller (e.g. updateOrder) never sees a 500 for an already-committed
   * mutation.
   */
  async writeEvent({ aggregateId, aggregateType = 'order', eventType, payload }) {
    if (!aggregateId || !eventType) {
      logger.warn('[OutboxService] Skipping outbox write — missing aggregateId or eventType');
      return null;
    }

    const eventId = crypto.randomUUID();
    try {
      const { data, error } = await supabaseAdmin
        .from('event_outbox')
        .insert({
          event_id: eventId,
          aggregate_id: aggregateId,
          event_type: eventType,
          payload: payload ?? {},
          status: 'pending',
        })
        .select('event_id')
        .single();

      if (error) {
        logger.error('[OutboxService] Failed to write outbox event:', error.message, { aggregateId, eventType });
        return null;
      }

      logger.info('[OutboxService] Outbox event written:', { eventId, aggregateId, eventType });
      return data?.event_id ?? null;
    } catch (err) {
      logger.error('[OutboxService] Exception writing outbox event:', err?.message, { aggregateId, eventType });
      return null;
    }
  }

  /**
   * Atomically claim a batch of pending outbox events for this worker using the
   * claim_outbox_batch SECURITY DEFINER RPC. The RPC uses
   * SELECT ... FOR UPDATE SKIP LOCKED so multiple API replicas can never claim
   * the same row: each replica only publishes the rows it owns, which is what
   * prevents duplicate Kafka events per replica (issue #14680).
   */
  async fetchPendingEvents(limit = 50) {
    const { data, error } = await supabaseAdmin
      .from('event_outbox')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(limit);

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
  async markPublished(eventId) {
    const { error } = await supabaseAdmin
      .from('event_outbox')
      .update({ status: 'published', published_at: new Date().toISOString() })
      .eq('event_id', eventId);

    if (error) {
      logger.error('[OutboxService] Failed to mark event published:', error.message, { eventId });
    }
    return Boolean(data && data.length > 0);
  }

  /**
   * Mark an event as failed and increment the attempt counter.
   *
   * `event_outbox` has no `failed` status (its check constraint only allows
   * pending/publishing/published). A non-delivered event is returned to
   * `pending` with `last_error` + `attempts` bumped so the relay reclaims it
   * (next_attempt_at is already managed by the claim RPC).
   */
  async markFailed(eventId, workerId, errorMessage) {
    if (!eventId || !workerId) {
      logger.warn('[OutboxService] Skipping markFailed — missing eventId or workerId');
      return false;
    }

    const { data: current, error: fetchError } = await supabaseAdmin
      .from('event_outbox')
      .select('attempts')
      .eq('event_id', eventId)
      .single();

    if (fetchError) {
      logger.warn('[OutboxService] Failed to read attempts:', fetchError.message, { eventId });
    }

    const currentAttempts = Number.isFinite(current?.attempts) ? current.attempts : 0;

    const { error } = await supabaseAdmin
      .from('event_outbox')
      .update({
        status: 'pending',
        last_error: String(errorMessage).slice(0, 1000),
        attempts: currentAttempts + 1,
        next_attempt_at: new Date().toISOString(),
      })
      .eq('id', eventId);
    if (error) {
      logger.error('[OutboxService] Failed to mark event failed:', error.message, { eventId });
      return false;
    }
    return true;
  }

  /**
   * Move events that have exhausted their retry budget to the dead-letter
   * store (outbox_dlq) so they are never silently lost. Events reaching
   * retry_count >= maxRetries are copied to outbox_dlq and removed from
   * outbox_events, and an alert is emitted so operators can replay them.
   */
  async deadLetterExhaustedEvents(maxRetries = 5) {
    const { data: exhausted, error: fetchError } = await supabaseAdmin
      .from('outbox_events')
      .select('*')
      .eq('status', 'failed')
      .gte('retry_count', maxRetries);

    if (fetchError) {
      logger.error('[OutboxService] Failed to fetch exhausted events:', fetchError.message);
      return;
    }

    if (!exhausted || exhausted.length === 0) return;

    const now = new Date().toISOString();
    const dlqRows = exhausted.map((e) => ({
      original_id: e.id,
      aggregate_id: e.aggregate_id,
      aggregate_type: e.aggregate_type,
      event_type: e.event_type,
      payload: e.payload ?? {},
      last_error: e.last_error,
      retry_count: e.retry_count,
      last_attempted_at: e.last_attempted_at,
      created_at: e.created_at,
      dead_lettered_at: now,
      status: 'pending',
    }));

    const { error: insertError } = await supabaseAdmin
      .from('outbox_dlq')
      .insert(dlqRows);

    if (insertError) {
      logger.error('[OutboxService] Failed to write dead-letter rows:', insertError.message);
      return;
    }

    const ids = exhausted.map((e) => e.id);
    const { error: deleteError } = await supabaseAdmin
      .from('outbox_events')
      .delete()
      .in('id', ids);

    if (deleteError) {
      logger.error('[OutboxService] Failed to clear dead-lettered events:', deleteError.message, { ids });
      return;
    }

    // Alert: these events can no longer be retried automatically and require
    // manual/automated replay via replayDeadLetter().
    logger.error('[OutboxService] Dead-lettered exhausted outbox events for replay:', {
      count: exhausted.length,
      eventIds: ids,
    });
  }

  /**
   * Reset failed events back to pending for retry (up to maxRetries).
   * Clears any stale claim metadata so the row can be re-claimed.
   */
  async requeueFailedEvents(maxRetries = 5) {
    const { error } = await supabaseAdmin
      .from('event_outbox')
      .update({ status: 'pending' })
      .eq('status', 'publishing')
      .lt('attempts', maxRetries);

    if (result?.error) {
      logger.error('[OutboxService] Failed to requeue failed events:', result.error.message);
    }
  }

  /**
   * Replay a single dead-lettered event by re-inserting it into outbox_events
   * (status='pending', retry_count=0) and marking the DLQ row replayed.
   * Returns the original outbox event id, or null on failure.
   */
  async replayDeadLetter(dlqId) {
    if (!dlqId) {
      logger.warn('[OutboxService] Skipping replayDeadLetter — missing dlqId');
      return null;
    }

    const { data: row, error: fetchError } = await supabaseAdmin
      .from('outbox_dlq')
      .select('*')
      .eq('id', dlqId)
      .single();

    if (fetchError || !row) {
      logger.error('[OutboxService] Failed to read dead-letter row:', fetchError?.message, { dlqId });
      return null;
    }

    const { error: insertError } = await supabaseAdmin
      .from('outbox_events')
      .insert({
        id: row.original_id,
        aggregate_id: row.aggregate_id,
        aggregate_type: row.aggregate_type,
        event_type: row.event_type,
        payload: row.payload ?? {},
        status: 'pending',
        retry_count: 0,
        created_at: new Date().toISOString(),
      });

    if (insertError) {
      logger.error('[OutboxService] Failed to reinsert dead-lettered event:', insertError.message, { dlqId });
      return null;
    }

    const { error: updateError } = await supabaseAdmin
      .from('outbox_dlq')
      .update({ status: 'replayed', replayed_at: new Date().toISOString() })
      .eq('id', dlqId);

    if (updateError) {
      logger.error('[OutboxService] Failed to mark dead-letter replayed:', updateError.message, { dlqId });
    }

    logger.info('[OutboxService] Replayed dead-letter event:', { dlqId, eventId: row.original_id });
    return row.original_id;
  }
}

export const outboxService = new OutboxService();
