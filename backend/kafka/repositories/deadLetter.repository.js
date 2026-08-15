import { supabaseAdmin } from '../../api/src/config/db.js';
import logger from '../../api/src/middleware/logger.js';

class DeadLetterRepository {
  async store({ topic, message, error, retryCount = 0 }) {
    try {
      const { data, error: dbError } = await supabaseAdmin
        .from('kafka_dead_letters')
        .insert({
          topic,
          message,
          error,
          retry_count: retryCount,
          status: 'pending',
        })
        .select('id')
        .single();

      if (dbError) throw dbError;
      return data;
    } catch (err) {
      logger.error(`Failed to persist dead letter for ${topic}:`, err);
      return null;
    }
  }

  async listPending({ topic = null, limit = 50 } = {}) {
    try {
      let query = supabaseAdmin
        .from('kafka_dead_letters')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(limit);

      if (topic) query = query.eq('topic', topic);

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    } catch (err) {
      logger.error('Failed to list pending dead letters:', err);
      throw err;
    }
  }

  async markStatus(id, status, { incrementRetry = false } = {}) {
    try {
      const update = {
        status,
        replayed_at: status === 'replayed' ? new Date().toISOString() : null,
      };

      if (incrementRetry) {
        const { data: current, error: fetchError } = await supabaseAdmin
          .from('kafka_dead_letters')
          .select('retry_count')
          .eq('id', id)
          .single();
        if (fetchError) throw fetchError;
        update.retry_count = (current?.retry_count || 0) + 1;
      }

      const { error } = await supabaseAdmin
        .from('kafka_dead_letters')
        .update(update)
        .eq('id', id);

      if (error) throw error;
    } catch (err) {
      logger.error(`Failed to update dead letter ${id} status to ${status}:`, err);
      throw err;
    }
  }
}

export default new DeadLetterRepository();