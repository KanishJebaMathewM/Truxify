import { supabaseAdmin } from '../../config/db.js';
import logger from '../../middleware/logger.js';
import crypto from 'crypto';

/**
 * Transactional Outbox Service
 * Inserts durable event records atomically with order mutations.
 * A separate relay picks them up and publishes to Kafka/event bus.
 *
 * SECURITY: every operation routes through the service-role admin client
 * (supabaseAdmin). `outbox_events` is an internal table with RLS enabled and
 * scoped to service_role only; the anon key can never read or write it.
 */
export class OutboxService {
  /**
   * Write an outbox event. Call this AFTER a successful order DB write
   * within the same logical operation so the event is always durable.
   *
   * Failures are NOT swallowed: a failed insert throws so the caller can
   * observe and alert instead of silently dropping the event.
   */
  async writeEvent({ aggregateId, aggregateType = 'order', eventType, payload }) {
    if (!aggregateId || !eventType) {
      logger.warn('[OutboxService] Skipping outbox write — missing aggregateId or eventType');
      return null;
    }

    if (!supabaseAdmin) {
      throw new Error('[OutboxService] supabaseAdmin is not configured — cannot write outbox event');
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
      // Surface to the caller: the order mutation may already have committed,
      // so the caller decides how to alert. Never return a silent null.
      throw new Error(
        `[OutboxService] Failed to write outbox event for ${aggregateType}:${aggregateId} (${eventType}): ${error.message}`
      );
    }

    logger.info('[OutboxService] Outbox event written:', { eventId, aggregateId, eventType });
    return data?.id ?? null;
  }

  /**
   * Fetch pending outbox events for the relay worker.
   */
  async fetchPendingEvents(limit = 50) {
    if (!supabaseAdmin) {
      logger.warn('[OutboxService] supabaseAdmin not configured — skipping fetchPendingEvents');
      return [];
    }

    const { data, error } = await supabaseAdmin
      .from('outbox_events')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error) {
      logger.error('[OutboxService] Failed to fetch pending events:', error.message);
      return [];
    }
    return data ?? [];
  }

  /**
   * Mark an event as published after successful Kafka delivery.
   */
  async markPublished(eventId) {
    if (!supabaseAdmin) {
      logger.warn('[OutboxService] supabaseAdmin not configured — skipping markPublished');
      return;
    }

    const { error } = await supabaseAdmin
      .from('outbox_events')
      .update({ status: 'published', published_at: new Date().toISOString() })
      .eq('id', eventId);

    if (error) {
      logger.error('[OutboxService] Failed to mark event published:', error.message, { eventId });
    }
  }

  /**
   * Mark an event as failed and increment retry_count.
   */
  async markFailed(eventId, errorMessage) {
    if (!eventId) {
      logger.warn('[OutboxService] Skipping markFailed — missing eventId');
      return;
    }

    if (!supabaseAdmin) {
      logger.warn('[OutboxService] supabaseAdmin not configured — skipping markFailed');
      return;
    }

    // Fetch the current retry_count first so the increment is computed in
    // JavaScript rather than embedding a query builder as a column value
    // (supabase.rpc() returns a PostgREST builder, not a scalar — using it
    // inside .update() would write an invalid value).
    const { data: event } = await supabaseAdmin
      .from('outbox_events')
      .select('retry_count')
      .eq('id', eventId)
      .maybeSingle();

    const newRetryCount = (event?.retry_count ?? 0) + 1;

    const { error } = await supabaseAdmin
      .from('outbox_events')
      .update({
        status: 'failed',
        last_error: String(errorMessage).slice(0, 1000),
        retry_count: newRetryCount,
        last_attempted_at: new Date().toISOString(),
      })
      .eq('id', eventId);

    if (error) {
      logger.error('[OutboxService] Failed to mark event failed:', error.message, { eventId });
    }
  }

  /**
   * Reset failed events back to pending for retry (up to maxRetries).
   */
  async requeueFailedEvents(maxRetries = 5) {
    if (!supabaseAdmin) {
      logger.warn('[OutboxService] supabaseAdmin not configured — skipping requeueFailedEvents');
      return;
    }

    const { error } = await supabaseAdmin
      .from('outbox_events')
      .update({ status: 'pending' })
      .eq('status', 'failed')
      .lt('retry_count', maxRetries);

    if (error) {
      logger.error('[OutboxService] Failed to requeue failed events:', error.message);
    }
  }
}

export const outboxService = new OutboxService();