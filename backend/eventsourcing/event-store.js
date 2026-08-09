import { v4 as uuidv4 } from 'uuid';
import logger from '../api/src/middleware/logger.js';
import { supabase } from '../api/src/config/db.js';
import { BaseEvent, EVENT_SOURCES, EVENT_CATEGORIES } from '../api/src/core/events/index.js';
import { ContextPropagator } from '../api/src/core/telemetry/ContextPropagator.js';
import spanFactory from '../api/src/core/telemetry/SpanFactory.js';
import { context, trace, SpanStatusCode } from '@opentelemetry/api';

import { EventStoreCore, normalizeEventRow } from './event-sourcing-core.js';
import {
  EventStoreValidationError,
  EventStoreVersionConflictError,
  EventStorePersistenceError,
  toEventStoreError,
} from './errors.js';

// Topic names mirror the values in backend/kafka/config/kafka.config.js.
// They are duplicated here (instead of importing TOPICS) so this package does
// not statically depend on kafkajs, which is not part of the repo's install.
const EVENT_TOPIC_MAP = {
  ORDER_CREATED: 'order.created',
  ORDER_UPDATED: 'order.updated',
  ORDER_CANCELLED: 'order.cancelled',
  DRIVER_ASSIGNED: 'driver.assigned',
};

const SNAPSHOT_THRESHOLD_ENV = Number(process.env.EVENT_STORE_SNAPSHOT_THRESHOLD) || 50;

/**
 * Persistence adapter translating the core's `db` contract to Supabase.
 * All insert/lookup logic (expected-version checks, uniqueness enforcement,
 * snapshot validation) lives in EventStoreCore; this adapter only moves rows.
 */
function createSupabaseDb(supabaseClient, loggerAdapter) {
  return {
    async fetchEventStream(aggregateId) {
      const { data, error } = await supabaseClient
        .from('event_store')
        .select('*')
        .eq('aggregate_id', aggregateId)
        .order('version', { ascending: true });
      if (error) {
        loggerAdapter.error(`Failed to fetch event stream for ${aggregateId}:`, error);
        throw toEventStoreError(error, { aggregateId });
      }
      return data || [];
    },

    async fetchLatestVersion(aggregateId) {
      const { data, error } = await supabaseClient
        .from('event_store')
        .select('version')
        .eq('aggregate_id', aggregateId)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        throw toEventStoreError(error, { aggregateId });
      }
      return data;
    },

    async insertEvent(row) {
      // Single atomic statement: INSERT ... ON CONFLICT (aggregate_id, version)
      // DO NOTHING. The unique index is the final safety mechanism — when the
      // version already exists this resolves to `{ data: [] }` and the core
      // raises a typed EventStoreVersionConflictError.
      return supabaseClient
        .from('event_store')
        .upsert([row], {
          onConflict: 'aggregate_id,version',
          ignoreDuplicates: true,
        });
    },

    async fetchSnapshot(aggregateId) {
      const { data, error } = await supabaseClient
        .from('snapshots')
        .select('*')
        .eq('aggregate_id', aggregateId)
        .single();
      if (error) {
        if (error.code === 'PGRST116') {
          return null; // no rows for this aggregate
        }
        loggerAdapter.error(`Failed to fetch snapshot for ${aggregateId}:`, error);
        throw toEventStoreError(error, { aggregateId });
      }
      return data;
    },

    async upsertSnapshot(row) {
      return supabaseClient
        .from('snapshots')
        .upsert([row], { onConflict: 'aggregate_id' });
    },
  };
}

class EventStore {
    constructor({ eventBus: externalEventBus = null, db = null, logger: loggerAdapter = logger, snapshotThreshold = SNAPSHOT_THRESHOLD_ENV, client = null } = {}) {
        this.logger = loggerAdapter;
        this.snapshotThreshold = snapshotThreshold;
        this.eventStore = new Map(); // kept for backwards compatibility with getEventStoreStats callers
        this.kafkaProducer = null;
        this.isInitialized = false;
        this._eventBus = externalEventBus || null;
        this._db = db; // injectable for tests; defaults to supabase-backed adapter
        this._client = client || supabase; // injectable for tests; defaults to the supabase client
        this._core = null;
        this._kafka = undefined; // lazy kafka module (null when unavailable)
    }

    setEventBus(eventBus) {
        this._eventBus = eventBus;
    }

    _getCore() {
        if (!this._core) {
            this._core = new EventStoreCore({
                db: this._db || createSupabaseDb(this._client, this.logger),
                logger: this.logger,
                snapshotThreshold: this.snapshotThreshold,
            });
        }
        return this._core;
    }

    async _loadKafka() {
        if (this._kafka === undefined) {
            try {
                this._kafka = await import('../kafka/config/kafka.config.js');
            } catch (error) {
                this.logger.warn('kafkajs is not installed — Kafka publishing disabled:', error?.message);
                this._kafka = null;
            }
        }
        return this._kafka;
    }

    async initialize() {
        if (this.isInitialized) return;
        const kafkaModule = await this._loadKafka();
        if (kafkaModule) {
            try {
                this.kafkaProducer = await kafkaModule.default.getProducer();
            } catch (error) {
                this.logger.warn('Kafka producer initialization failed:', error?.message);
            }
        }
        this.isInitialized = true;
        this.logger.info('✅ EventStore initialized');
    }

    // ============ Command Handling ============

    async handleCommand(command) {
        const span = spanFactory.startSpan('eventstore.handle_command', {
            attributes: {
                'command.type': command.type,
                'command.aggregate_id': command.aggregateId,
            },
        });

        try {
            await this.initialize();

            const commandId = uuidv4();
            const timestamp = new Date().toISOString();

            this.logger.info(`📝 Handling command: ${command.type}`, { commandId, aggregateId: command.aggregateId });

            const result = await context.with(trace.setSpan(context.active(), span), async () => {
                // Validate command
                const validation = await this.validateCommand(command);
                if (!validation.valid) {
                    throw new EventStoreValidationError(`Command validation failed: ${validation.error}`);
                }

                // Execute command and generate events
                const events = await this.executeCommand(command);

                // Store events under optimistic concurrency. When a command
                // emits multiple events, each one chains off the previous.
                const storedEvents = [];
                let lastVersion = null;
                for (const event of events) {
                    const expectedVersion =
                        event.expectedVersion !== undefined && event.expectedVersion !== null
                            ? event.expectedVersion
                            : lastVersion;
                    const stored = await this.storeEvent(event, expectedVersion);
                    lastVersion = stored.version;
                    storedEvents.push(stored);
                }

                // Publish events to Kafka / event bus
                await this.publishEvents(storedEvents);

                // Update read models
                await this.updateReadModels(storedEvents);

                // Check if snapshot needed
                await this.checkSnapshot(command.aggregateId);

                return {
                    commandId,
                    events: storedEvents,
                    timestamp,
                    success: true
                };
            });

            span.setStatus({ code: SpanStatusCode.OK });
            span.end();
            return result;
        } catch (error) {
            spanFactory.recordError(span, error);
            span.end();
            this.logger.error('Command handling failed:', error);
            throw toEventStoreError(error, { aggregateId: command.aggregateId });
        }
    }

    async validateCommand(command) {
        // Validate command based on type
        switch (command.type) {
            case 'CREATE_ORDER':
                return this.validateCreateOrder(command.payload);
            case 'UPDATE_ORDER':
                return this.validateUpdateOrder(command.payload);
            case 'CANCEL_ORDER':
                return this.validateCancelOrder(command.payload);
            case 'ASSIGN_DRIVER':
                return this.validateAssignDriver(command.payload);
            default:
                return { valid: true };
        }
    }

    validateCreateOrder(payload) {
        if (!payload.customerId) return { valid: false, error: 'customerId required' };
        if (!payload.amount) return { valid: false, error: 'amount required' };
        if (!payload.pickup) return { valid: false, error: 'pickup location required' };
        if (!payload.dropoff) return { valid: false, error: 'dropoff location required' };
        return { valid: true };
    }

    validateUpdateOrder(payload) {
        if (!payload.orderId) return { valid: false, error: 'orderId required' };
        return { valid: true };
    }

    validateCancelOrder(payload) {
        if (!payload.orderId) return { valid: false, error: 'orderId required' };
        if (!payload.reason) return { valid: false, error: 'reason required' };
        return { valid: true };
    }

    validateAssignDriver(payload) {
        if (!payload.orderId) return { valid: false, error: 'orderId required' };
        if (!payload.driverId) return { valid: false, error: 'driverId required' };
        return { valid: true };
    }

    async executeCommand(command) {
        const events = [];
        const timestamp = new Date().toISOString();

        switch (command.type) {
            case 'CREATE_ORDER':
                events.push({
                    id: uuidv4(),
                    type: 'ORDER_CREATED',
                    aggregateId: command.aggregateId || `order_${Date.now()}`,
                    payload: command.payload,
                    timestamp,
                    version: 1,
                    expectedVersion: 0 // a new aggregate must start from version 0
                });
                break;

            case 'UPDATE_ORDER': {
                const currentState = await this.getAggregateState(command.aggregateId);
                const currentVersion = currentState?.version ?? 0;
                events.push({
                    id: uuidv4(),
                    type: 'ORDER_UPDATED',
                    aggregateId: command.aggregateId,
                    payload: {
                        ...command.payload,
                        previousState: currentState
                    },
                    timestamp,
                    version: currentVersion + 1,
                    expectedVersion: currentVersion
                });
                break;
            }

            case 'CANCEL_ORDER': {
                const currentState = await this.getAggregateState(command.aggregateId);
                const currentVersion = currentState?.version ?? 0;
                events.push({
                    id: uuidv4(),
                    type: 'ORDER_CANCELLED',
                    aggregateId: command.aggregateId,
                    payload: {
                        orderId: command.payload.orderId,
                        reason: command.payload.reason,
                        cancelledAt: timestamp
                    },
                    timestamp,
                    version: currentVersion + 1,
                    expectedVersion: currentVersion
                });
                break;
            }

            case 'ASSIGN_DRIVER': {
                const currentState = await this.getAggregateState(command.aggregateId);
                const currentVersion = currentState?.version ?? 0;
                events.push({
                    id: uuidv4(),
                    type: 'DRIVER_ASSIGNED',
                    aggregateId: command.aggregateId,
                    payload: {
                        orderId: command.payload.orderId,
                        driverId: command.payload.driverId,
                        assignedAt: timestamp
                    },
                    timestamp,
                    version: currentVersion + 1,
                    expectedVersion: currentVersion
                });
                break;
            }

            default:
                throw new EventStoreValidationError(`Unknown command type: ${command.type}`);
        }

        return events;
    }

    // ============ Event Storage ============

    /**
     * Persists an event under optimistic concurrency control. On success the
     * core also refreshes the in-memory stream cache — a phantom event is
     * never cached, because the database insert happens first.
     */
    async storeEvent(event, expectedVersion) {
        return this._getCore().appendEvent(event.aggregateId, event, expectedVersion);
    }

    async getEventStream(aggregateId) {
        return this._getCore().getEventStream(aggregateId);
    }

    async getAggregateState(aggregateId) {
        return this._getCore().getAggregateState(aggregateId);
    }

    /** Clears in-memory caches (all aggregates, or one). Used on cold start. */
    clearCache(aggregateId) {
        return this._getCore().clearCache(aggregateId);
    }

    // ============ Snapshotting ============

    async checkSnapshot(aggregateId) {
        return this._getCore().checkSnapshot(aggregateId);
    }

    async takeSnapshot(aggregateId, state, version) {
        return this._getCore().takeSnapshot(aggregateId, state, version);
    }

    async getSnapshot(aggregateId) {
        return this._getCore().getSnapshot(aggregateId);
    }

    // ============ Projections ============

    async updateReadModels(events) {
        for (const event of events) {
            await this.updateReadModel(event);
        }
    }

    async updateReadModel(event) {
        switch (event.type) {
            case 'ORDER_CREATED':
                await this.updateOrderReadModel(event);
                break;
            case 'ORDER_UPDATED':
                await this.updateOrderReadModel(event);
                break;
            case 'ORDER_CANCELLED':
                await this.updateOrderReadModel(event);
                break;
            case 'DRIVER_ASSIGNED':
                await this.updateOrderReadModel(event);
                await this.updateDriverReadModel(event);
                break;
        }
    }

    /**
     * Persists the aggregate's full reconstructed state as the read model.
     * Both the live projection path and the rebuild endpoint converge on the
     * same payload shape (the aggregate state), so `payload->>status` and
     * `payload->>customerId` filters behave identically after warm writes and
     * after a rebuild.
     */
    async _upsertOrderReadModel(orderId, state, eventType, version) {
        const { error } = await this._client
            .from('orders_read_model')
            .upsert([{
                order_id: orderId,
                payload: state,
                event_type: eventType,
                version: version ?? state?.version,
                updated_at: new Date().toISOString()
            }], {
                onConflict: 'order_id'
            });

        if (error) {
            this.logger.error('Failed to update order read model:', error);
        }
    }

    async updateOrderReadModel(event) {
        const state = await this.getAggregateState(event.aggregateId);
        if (!state) {
            return;
        }
        await this._upsertOrderReadModel(event.aggregateId, state, event.type, event.version);
    }

    async updateDriverReadModel(event) {
        const { error } = await this._client
            .from('drivers_read_model')
            .upsert([{
                driver_id: event.payload.driverId,
                order_id: event.payload.orderId,
                assigned_at: event.payload.assignedAt,
                updated_at: new Date().toISOString()
            }], {
                onConflict: 'driver_id'
            });

        if (error) {
            this.logger.error('Failed to update driver read model:', error);
        }
    }

    /**
     * Rebuilds every read model from persisted event rows (used by
     * POST /eventsourcing/rebuild). Each aggregate is reconstructed from its
     * latest valid snapshot plus only the newer events, so the rebuild and a
     * live aggregate have identical state.
     */
    async rebuildProjections(rawRows) {
        const rows = rawRows || [];
        const aggregates = [...new Set(rows.map((r) => r.aggregate_id ?? r.aggregateId))];

        let orderCount = 0;
        for (const aggregateId of aggregates) {
            const aggRows = rows.filter((r) => (r.aggregate_id ?? r.aggregateId) === aggregateId);
            const sorted = aggRows
                .map(normalizeEventRow)
                .filter(Boolean)
                .sort((a, b) => Number(a.version) - Number(b.version));
            const lastEventType = sorted.length ? sorted[sorted.length - 1].type : 'REBUILT';

            const state = await this._getCore().rebuildFromRows(aggregateId, aggRows);
            if (state) {
                await this._upsertOrderReadModel(aggregateId, state, lastEventType, state.version);
                orderCount += 1;
            }
        }

        const driverEvents = rows
            .map(normalizeEventRow)
            .filter((event) => event && event.type === 'DRIVER_ASSIGNED');

        let driverCount = 0;
        for (const event of driverEvents) {
            await this.updateDriverReadModel(event);
            driverCount += 1;
        }

        return {
            aggregates: aggregates.length,
            orderCount,
            driverCount,
            eventCount: rows.length,
        };
    }

    // ============ Event Publishing ============

    async publishEvents(events) {
        for (const event of events) {
            await this.publishEvent(event);
        }
    }

    async publishEvent(event) {
        if (this._eventBus) {
            const baseEvent = new BaseEvent({
                eventType: event.type,
                payload: {
                    aggregateId: event.aggregateId,
                    ...event.payload,
                },
                source: EVENT_SOURCES.INTERNAL,
                category: EVENT_CATEGORIES.DOMAIN,
            });
            this._eventBus.publish(baseEvent, { deduplicate: false });
            this.logger.info(`📤 Event published via EventBus: ${event.type}`);
        } else {
            const topic = this.getEventTopic(event.type);
            const enriched = ContextPropagator.injectIntoEventPayload(event);
            const kafkaModule = await this._loadKafka();
            if (!kafkaModule) {
                this.logger.warn(`Kafka unavailable — skipping publish of ${event.type}`);
                return;
            }
            await kafkaModule.default.publishEvent(topic, enriched, event.aggregateId);
            this.logger.info(`📤 Event published to Kafka: ${event.type}`);
        }
    }

    getEventTopic(eventType) {
        return EVENT_TOPIC_MAP[eventType] || eventType;
    }

    // ============ Query ============

    async getOrderReadModel(orderId) {
        const { data, error } = await this._client
            .from('orders_read_model')
            .select('*')
            .eq('order_id', orderId)
            .single();

        if (error) {
            // Build from events if not found
            const state = await this.getAggregateState(orderId);
            if (state) {
                await this.updateOrderReadModel({
                    aggregateId: orderId,
                    payload: state,
                    type: 'ORDER_UPDATED'
                });
                return state;
            }
            return null;
        }
        return data;
    }

    async getOrderList(filters = {}) {
        let query = this._client
            .from('orders_read_model')
            .select('*');

        if (filters.status) {
            query = query.eq('payload->>status', filters.status);
        }
        if (filters.customerId) {
            query = query.eq('payload->>customerId', filters.customerId);
        }
        if (filters.limit) {
            query = query.limit(filters.limit);
        }

        const { data, error } = await query;
        if (error) {
            this.logger.error('Failed to get order list:', error);
            return [];
        }
        return data;
    }

    // ============ Stats ============

    async getEventStoreStats() {
        const { data: events, count: totalEvents, error: eventsError } = await this._client
            .from('event_store')
            .select('event_type', { count: 'exact' });

        const { count: totalSnapshots, error: snapshotsError } = await this._client
            .from('snapshots')
            .select('*', { count: 'exact', head: true });

        if (eventsError || snapshotsError) {
            this.logger.error('Failed to read event-store stats:', eventsError || snapshotsError);
        }

        return {
            totalEvents: totalEvents || 0,
            totalSnapshots: totalSnapshots || 0,
            eventTypes: events?.reduce((acc, e) => {
                acc[e.event_type] = (acc[e.event_type] || 0) + 1;
                return acc;
            }, {}),
            timestamp: new Date().toISOString()
        };
    }

    // ============ Optimistic concurrency (adapter level) ============

    /**
     * Appends an event requiring the current version to match `expectedVersion`.
     * Exposed for external consumers that want the same guarantee without going
     * through a full command. Returns the stored domain event.
     */
    async appendEvent(aggregateId, event, expectedVersion) {
        return this._getCore().appendEvent(aggregateId, event, expectedVersion);
    }
}

export default new EventStore();
export { EventStore, EventStoreVersionConflictError, EventStorePersistenceError };
