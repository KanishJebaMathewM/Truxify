import { supabase, supabaseAdmin } from '../../config/db.js';
import logger from '../../middleware/logger.js';

// Retries in minutes
const RETRY_BACKOFF = [1, 5, 15, 60];

// webhook_failures RLS grants access only to service_role (internal DLQ table).
// Use the service-role client so enqueue/claim/retry operations are not
// silently denied for the sessionless anon role; fall back to the anon client
// in environments where the service key is not configured (tests/dev).
function dlqDb() {
  return supabaseAdmin || supabase;
}

export const dlqService = {
  /**
   * Enqueue a failed webhook event to the Dead Letter Queue
   */
  async enqueueFailure(provider, eventType, payload, error) {
    try {
      const { error: insertErr } = await dlqDb()
        .from('webhook_failures')
        .insert({
          provider,
          event_type: eventType,
          payload,
          error_message: String(error.message || error).slice(0, 1000),
          retry_count: 0,
          next_retry_at: new Date(Date.now() + RETRY_BACKOFF[0] * 60000).toISOString(),
        });

      if (insertErr) {
        logger.error(`[DLQ] Failed to enqueue webhook failure: ${insertErr.message}`);
        return false;
      }

      logger.info(`[DLQ] Webhook failure enqueued successfully for ${provider} - ${eventType}`);
      return true;
    } catch (err) {
      logger.error(`[DLQ] Critical error enqueueing webhook failure: ${err.message}`);
      return false;
    }
  },

  /**
   * Process pending items in the Dead Letter Queue
   * To be called by a background worker
   */
  async processQueue(processFnMap) {
    try {
      const now = new Date().toISOString();

      // 1. Fetch up to 50 pending events safely without modifying them yet
      const { data: pendingEvents, error: fetchErr } = await dlqDb()
        .from('webhook_failures')
        .select('id')
        .eq('status', 'pending')
        .lte('next_retry_at', now)
        .order('next_retry_at', { ascending: true })
        .limit(50);

      if (fetchErr) {
        logger.error(`[DLQ] Failed to fetch pending events: ${fetchErr.message}`);
        return;
      }

      if (!pendingEvents || pendingEvents.length === 0) {
        return;
      }

      const eventIds = pendingEvents.map(e => e.id);

      // 2. Atomically claim only those specific events using CAS
      const { data: claimedEvents, error: claimErr } = await dlqDb()
        .from('webhook_failures')
        .update({ status: 'processing', updated_at: now })
        .eq('status', 'pending')
        .in('id', eventIds)
        .select('id, provider, event_type, payload, retry_count');

      if (claimErr) {
        logger.error(`[DLQ] Failed to claim pending events: ${claimErr.message}`);
        return;
      }

      if (!claimedEvents || claimedEvents.length === 0) {
        return;
      }

      for (const event of claimedEvents) {
        try {
          const handler = processFnMap[event.provider];
          if (!handler) {
            throw new Error(`No handler registered for provider: ${event.provider}`);
          }

          // Attempt to process again
          await handler(event.event_type, event.payload);

          // Success, mark as resolved
          await dlqDb()
            .from('webhook_failures')
            .update({ status: 'resolved', updated_at: new Date().toISOString() })
            .eq('id', event.id);

          logger.info(`[DLQ] Successfully resolved DLQ event ${event.id}`);

        } catch (procErr) {
          logger.error(`[DLQ] Retry failed for event ${event.id}: ${procErr.message}`);

          const newRetryCount = (event.retry_count ?? 0) + 1;
          const nextBackoffMin = RETRY_BACKOFF[newRetryCount] || -1;

          if (nextBackoffMin === -1) {
            // Failed permanently
            await dlqDb()
              .from('webhook_failures')
              .update({ 
                status: 'failed_permanently', 
                error_message: String(procErr.message || procErr).slice(0, 1000),
                updated_at: new Date().toISOString()
              })
              .eq('id', event.id);
            logger.warn(`[DLQ] Event ${event.id} marked as failed_permanently`);
          } else {
            // Schedule next retry by resetting status to pending so the event can be re-claimed.
            const nextRetryAt = new Date(Date.now() + nextBackoffMin * 60000).toISOString();
            await dlqDb()
              .from('webhook_failures')
              .update({
                status: 'pending',
                retry_count: newRetryCount,
                next_retry_at: nextRetryAt,
                error_message: String(procErr.message || procErr).slice(0, 1000),
                updated_at: new Date().toISOString(),
              })
              .eq('id', event.id);
          }
        }
      }
    } catch (err) {
      logger.error(`[DLQ] Critical error processing queue: ${err.message}`);
    }
  }
};
