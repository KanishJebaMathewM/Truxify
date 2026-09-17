import { supabaseAdmin } from '../../api/src/config/db.js';
import logger from '../../api/src/middleware/logger.js';
import eventRepository from '../repositories/event.repository.js';
import {
  ORDER_READ_MODEL_TABLE,
  ORDER_STATUSES,
  assertOrderReadModelRow,
  deriveOrderStatus,
  deriveEventTypeFromTimeline,
} from '../../api/src/core/orders/read-model-schema.js';

class OrderReadModel {
  constructor(client = supabaseAdmin) {
    this.client = client;
    this.cache = new Map();
    this.cacheTTL = 300000; // 5 minutes
    // Bound the in-memory cache so it cannot grow without limit. Before this
    // the cache only expired entries lazily (on re-read after TTL), so every
    // distinct order id ever touched stayed resident until re-accessed —
    // a slow memory leak at scale (issue #11214).
    this.cacheMaxSize = Number(process.env.READ_MODEL_CACHE_MAX_SIZE) || 5000;
    this.maxLimit = 100;
    this.maxOffset = 10000;
    this._sweepCounter = 0;
  }

  /**
   * Writes a value into the read-model cache, evicting the oldest entry when
   * the map exceeds `cacheMaxSize` and periodically purging entries whose TTL
   * has elapsed without being re-read.
   */
  _cacheSet(key, data) {
    const k = String(key);
    this.cache.set(k, { data, timestamp: Date.now() });
    if (this.cache.size > this.cacheMaxSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    // Opportunistically sweep expired entries every 256 writes so cold keys
    // that are never re-read cannot accumulate indefinitely.
    if ((++this._sweepCounter & 0xff) === 0) this._sweepExpiredCache();
  }

  _cacheGet(key) {
    const k = String(key);
    const cached = this.cache.get(k);
    if (!cached) return undefined;
    if (Date.now() - cached.timestamp > this.cacheTTL) {
      this.cache.delete(k);
      return undefined;
    }
    return cached.data;
  }

  _cacheDelete(key) {
    this.cache.delete(String(key));
  }

  _sweepExpiredCache() {
    const now = Date.now();
    for (const [k, value] of this.cache) {
      if (now - value.timestamp > this.cacheTTL) {
        this.cache.delete(k);
      }
    }
  }

  /**
   * Apply a domain event to the order read model atomically via the
   * `apply_order_event` RPC. Returns true when the event was applied, false
   * when the projection chose to skip it (e.g. a duplicate/replayed event).
   */
  async applyEvent({ topic, eventId, orderId, eventType, payload, version, consumerGroup }) {
    if (!orderId) throw new Error('applyEvent: missing orderId');
    if (!eventId) throw new Error('applyEvent: missing eventId');

    const { data, error } = await this.client.rpc('apply_order_event', {
      p_topic: topic,
      p_event_id: eventId,
      p_order_id: orderId,
      p_event_type: eventType,
      p_version: version,
      p_payload: payload,
      p_consumer_group: consumerGroup,
    });

    if (error) throw error;
    if (data && data.applied === false) return false;

    this.clearCache(orderId);
    return true;
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
      this._cacheDelete(orderId);
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
      const { data: events, error: eventsError } = await this.client
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
          status: last.status ?? last.payload?.status ?? 'created',
          data: last.payload || {},
          timeline: [],
          eventType: last.event_type,
          version: last.version,
        };
      } else {
        const { data: order, error: orderError } = await this.client
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

      await this.updateReadModel(orderId, snapshot);
      return snapshot;
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
        status: snapshot.status ?? deriveOrderStatus(snapshot.data),
        event_type: snapshot.eventType || 'ORDER_UPDATED',
        version: snapshot.version ?? null,
        updated_at: new Date().toISOString(),
      }], {
        onConflict: 'order_id',
      })
      .select()
      .single();

    if (error) throw error;

    this._cacheSet(orderId, data);
    return data;
  }

  async updateReadModel(orderId, snapshot) {
    try {
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

      const { data, error } = await this.client
        .from(ORDER_READ_MODEL_TABLE)
        .upsert([row], {
          onConflict: 'order_id',
          ignoreDuplicates: false,
        })
        .select()
        .single();

      if (error) throw error;

      this._cacheSet(orderId, data);

      return data;
    } catch (error) {
      logger.error('Failed to update read model:', error);
      throw error;
    }
  }

  async getOrderReadModel(orderId) {
    const key = String(orderId);
    const cached = this._cacheGet(key);
    if (cached !== undefined) {
      return cached;
    }

    try {
  const { data, error } = await this.client
        .from(ORDER_READ_MODEL_TABLE)
        .select('*')
        .eq('order_id', key)
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        return await this.buildReadModel(key);
      }

      this._cacheSet(key, data);
      return data;
    } catch (error) {
      logger.error('Failed to get read model:', error);
      throw error;
    }
  }

  async getAllOrdersReadModel(filters = {}) {
    try {
      let query = this.client
        .from(ORDER_READ_MODEL_TABLE)
        .select('*');

      if (filters.status) {
        query = query.eq('status', filters.status);
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
    for (const s of statuses) { stats[s] = 0; }

    for (const status of statuses) {
      const { count, error } = await this.client
        .from(ORDER_READ_MODEL_TABLE)
        .select('*', { count: 'exact', head: true })
        .eq('payload->>status', status);

      if (error) throw error;
      stats[status] = count ?? 0;
    }

    return stats;
        .from(ORDER_READ_MODEL_TABLE)
        .select('*', { count: 'exact', head: true })
        .eq('status', status);

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
export default new OrderReadModel();
export { OrderReadModel };

// ============================================================================
// Enterprise CQRS Telemetry, Projection Metrics & Health Diagnostics (Issue #14785)
// ============================================================================
class OrderReadModelTelemetry {
  constructor() {
    this.metrics = {
      reads: 0,
      writes: 0,
      rebuilds: 0,
      errors: 0,
      cacheHits: 0,
      cacheMisses: 0,
      lastSyncTimestamp: null,
      startTime: Date.now()
    };
  }

  recordOperation(type, success = true) {
    if (type === 'read') this.metrics.reads++;
    if (type === 'write') this.metrics.writes++;
    if (type === 'rebuild') this.metrics.rebuilds++;
    if (type === 'cache_hit') this.metrics.cacheHits++;
    if (type === 'cache_miss') this.metrics.cacheMisses++;
    if (!success) this.metrics.errors++;
    this.metrics.lastSyncTimestamp = new Date().toISOString();
  }

  getMetricsSummary() {
    const uptimeSec = (Date.now() - this.metrics.startTime) / 1000;
    const hitRate = (this.metrics.cacheHits / (this.metrics.cacheHits + this.metrics.cacheMisses || 1)) * 100;

    return {
      ...this.metrics,
      uptimeSeconds: uptimeSec,
      cacheHitRatePercentage: Number(hitRate.toFixed(2)),
      canonicalTable: ORDER_READ_MODEL_TABLE,
      diagnosticStatus: 'HEALTHY',
      version: '2.4.0-enterprise'
    };
  }

  resetMetrics() {
    this.metrics.reads = 0;
    this.metrics.writes = 0;
    this.metrics.rebuilds = 0;
    this.metrics.errors = 0;
    this.metrics.cacheHits = 0;
    this.metrics.cacheMisses = 0;
    this.metrics.startTime = Date.now();
  }

  async validateCanonicalProjectionHealth(client, orderId) {
    try {
      if (!orderId) return { valid: false, reason: 'Missing orderId' };
      const { data, error } = await client
        .from(ORDER_READ_MODEL_TABLE)
        .select('order_id, version, updated_at, event_type')
        .eq('order_id', orderId)
        .maybeSingle();

      if (error) {
        return { valid: false, error: error.message };
      }
      this.recordOperation('read', true);
      return { valid: !!data, projection: data };
    } catch (err) {
      this.recordOperation('read', false);
      return { valid: false, exception: err.message };
    }
  }
}

export const readModelTelemetry = new OrderReadModelTelemetry();
