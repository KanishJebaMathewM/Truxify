/**
 * Outbox persistence adapter (backend/kafka/repositories/outbox.repository.js).
 *
 * Wraps the transactional-outbox RPCs created in
 * supabase/migrations/20260810000000_event_outbox_and_read_model.sql:
 *
 *   - claimPending()     -> claim_outbox_events(...)  (FOR UPDATE SKIP LOCKED)
 *   - markPublished()    -> mark_outbox_published(...)
 *   - markFailed()       -> fail_outbox_events(...)
 *   - countPending()     -> read-only count for observability
 *
 * The default instance talks to Supabase via the service-role client. A client
 * can be injected for unit tests (see test/outbox.relay.test.js).
 *
 * DEPTH NOTE: this module lives at backend/kafka/repositories/, so api/src
 * imports use the ../../api/src depth (enforced by test/smoke.test.js).
 */
import { supabaseAdmin } from '../../api/src/config/db.js';

class OutboxRepository {
  constructor(client = supabaseAdmin) {
    this.client = client;
  }

  /**
   * Atomically claims up to `limit` pending outbox rows for publishing.
   * Rows are moved to 'publishing' and locked (SKIP LOCKED), so concurrent
   * relay workers never claim the same row twice.
   *
   * @param {number} limit
   * @returns {Promise<Array<object>>} claimed rows (database column layout)
   */
  async claimPending(limit = 100) {
    const { data, error } = await this.client.rpc('claim_outbox_events', { p_limit: limit });
    if (error) throw error;
    return data || [];
  }

  /**
   * Marks rows as durably published AFTER the Kafka send succeeded. A crash
   * between publish and mark leaves the row in 'publishing' with an expired
   * next_attempt_at, so it is reclaimed and re-published (at-least-once).
   *
   * @param {string[]} eventIds
   */
  async markPublished(eventIds) {
    if (!Array.isArray(eventIds) || eventIds.length === 0) return;
    const { error } = await this.client.rpc('mark_outbox_published', { p_event_ids: eventIds });
    if (error) throw error;
  }

  /**
   * Returns a failed row to 'pending' with exponential-ish backoff so the
   * relay retries it later. The event is never deleted and never lost.
   *
   * @param {string[]} eventIds
   * @param {string} errorMessage
   */
  async markFailed(eventIds, errorMessage) {
    if (!Array.isArray(eventIds) || eventIds.length === 0) return;
    const { error } = await this.client.rpc('fail_outbox_events', {
      p_event_ids: eventIds,
      p_error: errorMessage,
    });
    if (error) throw error;
  }

  async countPending() {
    const { count, error } = await this.client
      .from('event_outbox')
      .select('*', { count: 'exact', head: true })
      .in('status', ['pending', 'publishing']);
    if (error) throw error;
    return count || 0;
  }
}

export default new OutboxRepository();
export { OutboxRepository };
