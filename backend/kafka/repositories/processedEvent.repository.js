import { supabaseAdmin } from '../../api/src/config/db.js';
import logger from '../../api/src/middleware/logger.js';

// A claim that stays in 'processing' longer than this (e.g. the consumer
// crashed mid-handler) is considered stale and can be re-claimed by the next
// delivery instead of being skipped forever.
const DEFAULT_STALE_PROCESSING_MS = 5 * 60 * 1000;

class ProcessedEventRepository {
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
   * @param {{ staleProcessingAfterMs?: number }} [options]
   * @returns {Promise<boolean>} true when the event was claimed for
   *          (re)processing, false when it is already completed or actively
   *          being processed elsewhere.
   */
  async claimProcessing(topic, eventId, orderId = null, { staleProcessingAfterMs = DEFAULT_STALE_PROCESSING_MS } = {}) {
    try {
      const { data, error } = await supabaseAdmin
        .from('kafka_processed_events')
        .upsert({
          topic,
          event_id: eventId,
          order_id: orderId || null,
          status: 'processing',
          started_at: new Date().toISOString(),
        }, {
          onConflict: 'topic,event_id',
          ignoreDuplicates: true,
        })
        .select('event_id');

      if (error) throw error;
      // Newly inserted -> claimed.
      if (Array.isArray(data) ? data.length > 0 : data !== null) {
        return true;
      }

      // Row already exists — decide whether it can be re-claimed.
      const { data: existing, error: fetchError } = await supabaseAdmin
        .from('kafka_processed_events')
        .select('status, started_at')
        .eq('topic', topic)
        .eq('event_id', eventId)
        .maybeSingle();

      if (fetchError) throw fetchError;

      if (!existing || existing.status === 'completed') {
        return false;
      }

      if (existing.status === 'processing') {
        const startedAt = existing.started_at ? new Date(existing.started_at).getTime() : 0;
        if (Date.now() - startedAt < staleProcessingAfterMs) {
          // Actively being processed (possibly by another instance) — skip so
          // the side effect is never applied twice concurrently.
          return false;
        }
      }

      // 'failed', or a stale 'processing' claim: take the claim back. The
      // guarded UPDATE means only one concurrent reclaimer wins.
      const { data: updated, error: updateError } = await supabaseAdmin
        .from('kafka_processed_events')
        .update({
          status: 'processing',
          started_at: new Date().toISOString(),
          order_id: orderId || null,
        })
        .eq('topic', topic)
        .eq('event_id', eventId)
        .eq('status', existing.status)
        .select('event_id');

      if (updateError) throw updateError;
      return Array.isArray(updated) ? updated.length > 0 : updated !== null;
    } catch (error) {
      logger.error(`Failed to claim processed event ${eventId} on ${topic}:`, error);
      throw error;
    }
  }

  /**
   * Mark a claimed event as fully processed after its handlers succeeded.
   */
  async markCompleted(topic, eventId) {
    try {
      const { error } = await supabaseAdmin
        .from('kafka_processed_events')
        .update({ status: 'completed' })
        .eq('topic', topic)
        .eq('event_id', eventId)
        .eq('status', 'processing');
      if (error) throw error;
    } catch (error) {
      logger.error(`Failed to mark processed event ${eventId} on ${topic} as completed:`, error);
      throw error;
    }
  }

  /**
   * Mark a claimed event as failed after a handler threw, so a later
   * delivery can re-claim and retry it.
   */
  async markFailed(topic, eventId) {
    try {
      const { error } = await supabaseAdmin
        .from('kafka_processed_events')
        .update({ status: 'failed' })
        .eq('topic', topic)
        .eq('event_id', eventId)
        .eq('status', 'processing');
      if (error) throw error;
    } catch (error) {
      logger.error(`Failed to mark processed event ${eventId} on ${topic} as failed:`, error);
      throw error;
    }
  }
}

export default new ProcessedEventRepository();
