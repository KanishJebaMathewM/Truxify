/**
 * Transactional outbox relay (backend/kafka/relay/outbox.relay.js).
 *
 * The authoritative order-event pipeline is:
 *
 *   order mutation (DB tx, incl. outbox insert)
 *     -> COMMIT
 *     -> OUTBOX RELAY (this module)
 *     -> KAFKA
 *     -> CONSUMER (backend/kafka/consumers/order.consumer.js)
 *     -> SINGLE READ MODEL (orders_read_model)
 *
 * The relay:
 *   1. atomically claims pending outbox rows (claim_outbox_events, SKIP LOCKED)
 *   2. builds the Kafka envelope — eventId and aggregateId are DISTINCT;
 *      the Kafka key is always the real aggregate/order id (never the event id)
 *   3. publishes to Kafka
 *   4. marks rows published ONLY after the send succeeded
 *   5. on failure, returns rows to 'pending' with backoff for retry
 *
 * At-least-once: a crash between publish and mark re-publishes the event, and
 * the consumer deduplicates via kafka_processed_events (apply_order_event).
 *
 * DEPTH NOTE: backend/kafka/relay is a depth-2 directory, so api/src imports
 * use the ../../api/src depth (enforced by test/smoke.test.js).
 */
import logger from '../../api/src/middleware/logger.js';
import { TOPICS } from '../config/kafka.config.js';

const DEFAULT_TOPIC_MAP = {
  ORDER_CREATED: TOPICS.ORDER_CREATED,
  ORDER_UPDATED: TOPICS.ORDER_UPDATED,
  ORDER_CANCELLED: TOPICS.ORDER_CANCELLED,
  DRIVER_ASSIGNED: TOPICS.DRIVER_ASSIGNED,
};

/**
 * Maps an outbox row to the Kafka event envelope.
 *
 * The envelope keeps `eventId` and `aggregateId` as separate concepts — the
 * legacy pipeline wrongly used the event uuid as the order id. The consumer
 * and the relay key on `aggregateId` for the order and on `eventId` for
 * idempotency.
 *
 * @param {object} row event_outbox row (event_id, aggregate_id, event_type,
 *                     payload, version, created_at)
 * @returns {object} Kafka envelope
 */
export function buildOrderEventEnvelope(row) {
  let payload = row.payload;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      payload = {};
    }
  }

  return {
    eventId: row.event_id,
    aggregateId: row.aggregate_id,
    orderId: row.aggregate_id,
    eventType: row.event_type,
    payload: payload || {},
    version: row.version != null ? Number(row.version) : null,
    timestamp: row.created_at || row.timestamp || new Date().toISOString(),
    metadata: {
      source: 'event_outbox',
      isReplay: Boolean(row.is_replay),
    },
  };
}

export class OutboxRelay {
  /**
   * @param {object} options
   * @param {object} options.repository  claimPending/markPublished/markFailed
   * @param {object} options.publisher   async ({ topic, key, envelope }) => void
   * @param {Function} [options.topicFor] maps event_type -> Kafka topic
   * @param {object} [options.loggerAdapter]
   * @param {Function} [options.sleep]    async ms => void (injectable for tests)
   */
  constructor({ repository, publisher, topicFor, loggerAdapter = logger, sleep }) {
    if (!repository || !publisher) {
      throw new Error('OutboxRelay requires a repository and a publisher');
    }
    this.repository = repository;
    this.publisher = publisher;
    this.topicFor = topicFor || ((eventType) => DEFAULT_TOPIC_MAP[eventType] || null);
    this.logger = loggerAdapter;
    this.sleep = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this._running = false;
  }

  /**
   * Runs one relay cycle: claim -> publish -> mark published / mark failed.
   *
   * @param {{limit?: number}} [options]
   * @returns {Promise<{claimed: number, published: number, failed: number}>}
   */
  async publishPending({ limit = 100 } = {}) {
    const claimed = await this.repository.claimPending(limit);
    const results = { claimed: claimed.length, published: 0, failed: 0 };

    for (const row of claimed) {
      const topic = this.topicFor(row.event_type);
      if (!topic) {
        try {
          await this.repository.markFailed([row.event_id], `No Kafka topic mapped for ${row.event_type}`);
        } catch (markError) {
          this.logger.error('Outbox markFailed failed:', markError);
        }
        results.failed += 1;
        continue;
      }

      const envelope = buildOrderEventEnvelope(row);
      try {
        await this.publisher({ topic, key: row.aggregate_id, envelope });
        await this.repository.markPublished([row.event_id]);
        results.published += 1;
        this.logger.info(`📤 Outbox relay published ${row.event_type} for order ${row.aggregate_id}`, {
          eventId: row.event_id,
          topic,
        });
      } catch (error) {
        results.failed += 1;
        this.logger.error(`❌ Outbox relay publish failed for ${row.event_id}:`, error?.message || error);
        try {
          await this.repository.markFailed([row.event_id], error?.message || 'Kafka publish failed');
        } catch (markError) {
          // Row stays 'publishing' with a claim-time backoff, so the next
          // cycle reclaims it. The event is never lost.
          this.logger.error('Outbox markFailed failed (will be reclaimed):', markError?.message || markError);
        }
      }
    }

    return results;
  }

  /**
   * Runs relay cycles forever (until stop()/stopSignal), tolerating individual
   * failures so a Kafka outage never crashes the relay or loses committed
   * events.
   */
  async run({ intervalMs = 5000, limit = 100, stopSignal } = {}) {
    this._running = true;
    while (this._running) {
      if (stopSignal?.aborted) break;
      try {
        await this.publishPending({ limit });
      } catch (error) {
        this.logger.error('❌ Outbox relay cycle failed:', error?.message || error);
      }
      await this.sleep(intervalMs);
    }
  }

  stop() {
    this._running = false;
  }
}

export default OutboxRelay;
