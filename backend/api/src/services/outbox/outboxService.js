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
   * Fetch pending outbox events for the relay worker.
   */
  async fetchPendingEvents(limit = 50) {
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
   *
   * The new retry_count is computed in JS: the previous implementation
   * assigned an unawaited `supabase.rpc('increment', ...)` Promise to the
   * column, so the counter never advanced and dead-lettering never triggered.
   */
  async markFailed(eventId, errorMessage) {
    if (!eventId) {
      logger.warn('[OutboxService] Skipping markFailed — missing eventId');
      return;
    }

    const { data: current, error: fetchError } = await supabaseAdmin
      .from('outbox_events')
      .select('retry_count')
      .eq('id', eventId)
      .single();

    if (fetchError) {
      logger.warn('[OutboxService] Failed to read retry_count:', fetchError.message, { eventId });
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
      .eq('id', eventId);

    if (error) {
      logger.error('[OutboxService] Failed to mark event failed:', error.message, { eventId });
    }
  }

  /**
   * Reset failed events back to pending for retry (up to maxRetries).
   */
  async requeueFailedEvents(maxRetries = 5) {
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