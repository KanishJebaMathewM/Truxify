import { supabaseAdmin } from '../../api/src/config/db.js';
import logger from '../../api/src/middleware/logger.js';

class ProcessedEventRepository {
  /**
   * Atomically claim a Kafka message as processed.
   *
   * Uses an upsert on the (topic, event_id) primary key so concurrent or
   * redelivered messages race safely: only the first insert wins.
   *
   * @returns {Promise<boolean>} true when the message was newly claimed,
   *          false when it had already been processed.
   */
  async claimProcessed(topic, eventId, orderId = null) {
    try {
      const { data, error } = await supabaseAdmin
        .from('kafka_processed_events')
        .upsert({
          topic,
          event_id: eventId,
          order_id: orderId || null,
        }, {
          onConflict: 'topic,event_id',
          ignoreDuplicates: true,
        })
        .select('event_id');

      if (error) throw error;
      return Array.isArray(data) ? data.length > 0 : data !== null;
    } catch (error) {
      logger.error(`Failed to claim processed event ${eventId} on ${topic}:`, error);
      throw error;
    }
  }
}

export default new ProcessedEventRepository();
