import { supabase } from '../../config/db.js';
import logger from '../../middleware/logger.js';

// Retries in minutes
const RETRY_BACKOFF = [1, 5, 15, 60]; 

export const dlqService = {
  /**
   * Enqueue a failed webhook event to the Dead Letter Queue
   */
  async enqueueFailure(provider, eventType, payload, error) {
    try {
      const { error: insertErr } = await supabase
        .from('webhook_failures')
        .insert({
          provider,
          event_type: eventType,
          payload,
          error_message: String(error.message || error).slice(0, 1000),
          next_retry_at: new Date(Date.now() + RETRY_BACKOFF[0] * 60000).toISOString(),
        });

      if (insertErr) {
        logger.error(`[DLQ] Failed to enqueue webhook failure: ${insertErr.message}`);
      } else {
        logger.info(`[DLQ] Webhook failure enqueued successfully for ${provider} - ${eventType}`);
      }
    } catch (err) {
      logger.error(`[DLQ] Critical error enqueueing webhook failure: ${err.message}`);
    }
  },

  /**
   * Process pending items in the Dead Letter Queue
   * To be called by a background worker
   */
  async processQueue(processFnMap) {
    try {
      const now = new Date().toISOString();
      const { data: pendingEvents, error: fetchErr } = await supabase
        .from('webhook_failures')
        .select('*')
        .eq('status', 'pending')
        .lte('next_retry_at', now)
        .order('next_retry_at', { ascending: true })
        .limit(50); // Process in batches

      if (fetchErr) {
        logger.error(`[DLQ] Failed to fetch pending events: ${fetchErr.message}`);
        return;
      }

      for (const event of pendingEvents || []) {
        try {
          const handler = processFnMap[event.provider];
          if (!handler) {
            throw new Error(`No handler registered for provider: ${event.provider}`);
          }

          // Attempt to process again
          await handler(event.event_type, event.payload);

          // Success, mark as resolved
          await supabase
            .from('webhook_failures')
            .update({ status: 'resolved', updated_at: new Date().toISOString() })
            .eq('id', event.id);

          logger.info(`[DLQ] Successfully resolved DLQ event ${event.id}`);

        } catch (procErr) {
          logger.error(`[DLQ] Retry failed for event ${event.id}: ${procErr.message}`);

          const newRetryCount = event.retry_count + 1;
          const nextBackoffMin = RETRY_BACKOFF[newRetryCount] || -1;

          if (nextBackoffMin === -1) {
            // Failed permanently
            await supabase
              .from('webhook_failures')
              .update({ 
                status: 'failed_permanently', 
                error_message: String(procErr.message || procErr).slice(0, 1000),
                updated_at: new Date().toISOString()
              })
              .eq('id', event.id);
            logger.warn(`[DLQ] Event ${event.id} marked as failed_permanently`);
          } else {
            // Schedule next retry
            const nextRetryAt = new Date(Date.now() + nextBackoffMin * 60000).toISOString();
            await supabase
              .from('webhook_failures')
              .update({ 
                retry_count: newRetryCount,
                next_retry_at: nextRetryAt,
                error_message: String(procErr.message || procErr).slice(0, 1000),
                updated_at: new Date().toISOString()
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
