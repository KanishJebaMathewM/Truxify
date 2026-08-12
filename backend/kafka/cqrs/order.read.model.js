/**
 * SINGLE AUTHORITATIVE ORDER READ MODEL (backend/kafka/cqrs/order.read.model.js)
 *
 * Resolves Issue #1: the repository previously maintained two competing order
 * read models — `order_read_models` (legacy kafka CQRS, status/data/timeline
 * columns) and `orders_read_model` (eventsourcing projection, payload/version
 * columns). This module now writes ONLY `orders_read_model` and is the single
 * writer of the order read model in the active pipeline.
 *
 * Pipeline:
 *   order mutation -> event_outbox -> OUTBOX RELAY -> KAFKA
 *   -> CONSUMER (order.consumer.js) -> applyEvent() (this module)
 *   -> orders_read_model  +  kafka_processed_events   (atomic, via RPC)
 *
 * Idempotency: applyEvent() runs `apply_order_event` which inserts the
 * kafka_processed_events record and the read-model row in ONE transaction.
 * Duplicate/replayed messages are no-ops (applied=false). An event is never
 * marked processed before its read-model update succeeds.
 */
import { supabase, supabaseAdmin } from '../../api/src/config/db.js';
import logger from '../../api/src/middleware/logger.js';
import eventRepository from '../repositories/event.repository.js';
import {
  ORDER_READ_MODEL_TABLE,
  assertOrderReadModelRow,
  deriveOrderStatus,
  deriveEventTypeFromTimeline,
} from '../../api/src/core/orders/read-model-schema.js';

class OrderReadModel {
  constructor(client = supabaseAdmin) {
    this.client = client;
    this.cache = new Map();
    this.cacheTTL = 300000; // 5 minutes
    this.maxLimit = 100;
    this.maxOffset = 10000;
  }

  parsePaginationValue(value, { field, min, max }) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'number' && typeof value !== 'string') {
      throw new Error(`${field} must be an integer`);
    }
    const text = String(value);
    if (!/^\d+$/.test(text)) {
      throw new Error(`${field} must be an integer`);
    }
    const parsed = Number(text);
    if (!Number.isSafeInteger(parsed) || parsed < min) {
      throw new Error(`${field} must be at least ${min}`);
    }
    return Math.min(parsed, max);
  }

  /**
   * Atomically applies a consumed Kafka event to the read model.
   *
   * The `apply_order_event` RPC inserts the kafka_processed_events idempotency
   * record and upserts `orders_read_model` in a single transaction, returning
   * whether this event was newly applied. A duplicate, replayed or retried
   * message returns false and is skipped — it can never double-apply.
   *
   * @param {{topic: string, eventId: string, orderId: string,
   *          eventType: string, payload: object, version: number|null}} event
   * @returns {Promise<boolean>} true when newly applied, false when duplicate
   */
  async applyEvent({ topic, eventId, orderId, eventType, payload, version }) {
    if (!orderId) {
      throw new Error('applyEvent requires an orderId (aggregate id)');
    }
    if (!eventId) {
      throw new Error('applyEvent requires an eventId');
    }
    const { data, error } = await this.client.rpc('apply_order_event', {
      p_order_id: String(orderId),
      p_payload: payload || {},
      p_event_type: eventType || 'ORDER_UPDATED',
      p_version: version != null ? Number(version) : null,
      p_topic: topic,
      p_event_id: eventId,
    });
    if (error) throw error;
    const applied = Boolean(data && data.applied === true);
    if (applied) {
      this.cache.delete(String(orderId));
    }
    return applied;
  }

  /**
   * Rebuilds a single order read model from the authoritative outbox log.
   * The latest event carries the full order snapshot, so the rebuild replays
   * the outbox rows ordered by version and takes the newest payload. If no
   * outbox events exist the order is snapshotted straight from `orders`.
   *
   * @param {string} orderId
   * @returns {Promise<object|null>} read-model row or null
   */
  async buildReadModel(orderId) {
    try {
      const { data: events, error: eventsError } = await supabase
        .from('event_outbox')
        .select('event_id, event_type, payload, version, created_at')
        .eq('aggregate_id', String(orderId))
        .order('version', { ascending: true });

      if (eventsError) throw eventsError;

      let snapshot = null;
      if (events && events.length > 0) {
        const last = events[events.length - 1];
        snapshot = {
          orderId,
          status: last.payload?.status ?? 'created',
          data: last.payload || {},
          timeline: [],
          eventType: last.event_type,
          version: last.version,
        };
      } else {
        const { data: order, error: orderError } = await supabase
          .from('orders')
          .select('*')
          .eq('id', orderId)
          .maybeSingle();
        if (orderError) throw orderError;
        if (!order) return null;
        snapshot = {
          orderId,
          status: order.status ?? 'pending',
          data: order,
          timeline: [],
          eventType: 'ORDER_CREATED',
          version: order.version ?? 1,
        };
      }

      await this.upsertFromSnapshot(orderId, snapshot);
      return snapshot;
      // Get snapshot from events
      const snapshot = await eventRepository.getSnapshot(orderId);

      if (snapshot) {
        // Update read model in database
        await this.updateReadModel(orderId, snapshot);
        return snapshot;
      }

      return null;
    } catch (error) {
      logger.error('Failed to build read model:', error);
      throw error;
    }
  }

  /**
   * Upserts the read-model row from a snapshot shape
   * ({ status, data, eventType, version }). Payload is the full order snapshot.
   */
  async upsertFromSnapshot(orderId, snapshot) {
    const { data, error } = await this.client
      .from('orders_read_model')
      .upsert([{
        order_id: orderId,
        payload: snapshot.data || {},
        event_type: snapshot.eventType || 'ORDER_UPDATED',
        version: snapshot.version ?? null,
        updated_at: new Date().toISOString(),
      }], {
        onConflict: 'order_id',
      })
      .select()
      .single();

    if (error) throw error;

    this.cache.set(orderId, {
      data,
      timestamp: Date.now(),
    });
    return data;
  async updateReadModel(orderId, snapshot) {
    try {
      // The snapshot's `data` / `status` / `timeline` shape maps onto the
      // canonical orders_read_model columns (payload / status / timeline).
      // event_type and version are derived from the timeline because the
      // snapshot carries no explicit version. The row is validated against
      // the canonical schema before the upsert so projection/schema drift
      // fails loudly instead of writing nonexistent columns.
      const timeline = Array.isArray(snapshot.timeline) ? snapshot.timeline : [];
      const row = assertOrderReadModelRow({
        order_id: orderId,
        payload: snapshot.data ?? {},
        event_type: deriveEventTypeFromTimeline(timeline),
        version: timeline.length > 0 ? timeline.length : null,
        status: snapshot.status ?? deriveOrderStatus(snapshot.data),
        timeline,
        updated_at: new Date().toISOString(),
      });

      // Upsert read model
      const { data, error } = await supabase
        .from(ORDER_READ_MODEL_TABLE)
        .upsert([row], {
          onConflict: 'order_id',
          ignoreDuplicates: false,
        })
        .select()
        .single();

      if (error) throw error;

      // Update cache
      this.cache.set(orderId, {
        data: data,
        timestamp: Date.now(),
      });

      return data;
    } catch (error) {
      logger.error('Failed to update read model:', error);
      throw error;
    }
  }

  async getOrderReadModel(orderId) {
    const key = String(orderId);
    if (this.cache.has(key)) {
      const cached = this.cache.get(key);
      if (Date.now() - cached.timestamp < this.cacheTTL) {
        return cached.data;
      }
      this.cache.delete(key);
    }

    try {
      const { data, error } = await supabase
        .from('orders_read_model')
        .from(ORDER_READ_MODEL_TABLE)
        .select('*')
        .eq('order_id', key)
        .single();

      if (error) {
        // If not found, rebuild from the authoritative outbox/orders tables.
        return await this.buildReadModel(key);
      }

      this.cache.set(key, { data, timestamp: Date.now() });
      // Cache it
      this.cache.set(orderId, {
        data: data,
        timestamp: Date.now(),
      });

      return data;
    } catch (error) {
      logger.error('Failed to get read model:', error);
      return null;
    }
  }

  async getAllOrdersReadModel(filters = {}) {
    try {
      let query = supabase
        .from('orders_read_model')
        .select('*');

      // Payload is the full order row snapshot, so filters target payload keys.
        .from(ORDER_READ_MODEL_TABLE)
        .select('*');

      // Apply filters
      if (filters.status) {
        query = query.eq('payload->>status', filters.status);
      }
      if (filters.customerId) {
        query = query.eq('payload->>customer_id', filters.customerId);
      }
      if (filters.driverId) {
        query = query.eq('payload->>driver_id', filters.driverId);
        query = query.eq('payload->customer_id', filters.customerId);
      }
      if (filters.driverId) {
        query = query.eq('payload->driver_id', filters.driverId);
      }
      if (filters.fromDate) {
        query = query.gte('updated_at', filters.fromDate);
      }
      if (filters.toDate) {
        query = query.lte('updated_at', filters.toDate);
      }

      query = query.order('updated_at', { ascending: false });

      const limit = this.parsePaginationValue(filters.limit, {
        field: 'limit',
        min: 1,
        max: this.maxLimit,
      });
      const offset = this.parsePaginationValue(filters.offset, {
        field: 'offset',
        min: 0,
        max: this.maxOffset,
      });

      if (limit !== null) {
        query = query.limit(limit);
      }
      if (offset !== null) {
        query = query.offset(offset);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    } catch (error) {
      logger.error('Failed to get all read models:', error);
      return [];
    }
  }

  /**
   * Per-status order counts, derived from the snapshot payload stored in the
   * single authoritative read model.
   */
  async getOrderStats() {
    const statuses = ['pending', 'truck_assigned', 'en_route_pickup', 'arrived_pickup', 'picked_up', 'in_transit', 'arriving', 'delivered', 'payment_released', 'cancelled'];
    const stats = {};

    for (const status of statuses) {
      const { count, error } = await supabase
        .from('orders_read_model')
        .from(ORDER_READ_MODEL_TABLE)
        .select('*', { count: 'exact', head: true })
        .eq('payload->>status', status);

      if (error) throw error;
      stats[status] = count ?? 0;
    }

    return stats;
  }

  async clearCache() {
    this.cache.clear();
    logger.info('Read model cache cleared');
  }
}

export default new OrderReadModel();
export { OrderReadModel };
