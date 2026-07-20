import kafka from '../kafka/config/kafka.config.js';
import { TOPICS } from '../kafka/config/kafka.config.js';
import { v4 as uuidv4 } from 'uuid';
import logger from '../../api/src/middleware/logger.js';
import { supabase } from '../../api/src/config/db.js';

class EventStore {
    constructor() {
        this.eventStore = new Map(); // In-memory cache
        this.eventStreams = new Map();
        this.snapshots = new Map();
        this.snapshotThreshold = 50; // Take snapshot every 50 events
        this.kafkaProducer = null;
        this.isInitialized = false;
    }

    async initialize() {
        if (this.isInitialized) return;
        this.kafkaProducer = await kafka.getProducer();
        this.isInitialized = true;
        logger.info('✅ EventStore initialized');
    }

    // ============ Command Handling ============

    async handleCommand(command) {
        try {
            await this.initialize();
            
            const commandId = uuidv4();
            const timestamp = new Date().toISOString();
            
            logger.info(`📝 Handling command: ${command.type}`, { commandId, aggregateId: command.aggregateId });

            // Validate command
            const validation = await this.validateCommand(command);
            if (!validation.valid) {
                throw new Error(`Command validation failed: ${validation.error}`);
            }

            // Execute command and generate events
            const events = await this.executeCommand(command);

            // Store events
            for (const event of events) {
                await this.storeEvent(event);
            }

            // Publish events to Kafka
            await this.publishEvents(events);

            // Update read models
            await this.updateReadModels(events);

            // Check if snapshot needed
            await this.checkSnapshot(command.aggregateId);

            return {
                commandId,
                events,
                timestamp,
                success: true
            };
        } catch (error) {
            logger.error('Command handling failed:', error);
            throw error;
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
                    version: 1
                });
                break;

            case 'UPDATE_ORDER':
                const currentState = await this.getAggregateState(command.aggregateId);
                events.push({
                    id: uuidv4(),
                    type: 'ORDER_UPDATED',
                    aggregateId: command.aggregateId,
                    payload: {
                        ...command.payload,
                        previousState: currentState
                    },
                    timestamp,
                    version: (currentState?.version || 0) + 1
                });
                break;

            case 'CANCEL_ORDER':
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
                    version: (await this.getAggregateState(command.aggregateId)?.version || 0) + 1
                });
                break;

            case 'ASSIGN_DRIVER':
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
                    version: (await this.getAggregateState(command.aggregateId)?.version || 0) + 1
                });
                break;

            default:
                throw new Error(`Unknown command type: ${command.type}`);
        }

        return events;
    }

    // ============ Event Storage ============

    async storeEvent(event) {
        // Store in memory
        if (!this.eventStreams.has(event.aggregateId)) {
            this.eventStreams.set(event.aggregateId, []);
        }
        this.eventStreams.get(event.aggregateId).push(event);

        // Store in database
        const { error } = await supabase
            .from('event_store')
            .insert([{
                event_id: event.id,
                event_type: event.type,
                aggregate_id: event.aggregateId,
                payload: event.payload,
                version: event.version,
                timestamp: event.timestamp,
                created_at: new Date().toISOString()
            }]);

        if (error) {
            logger.error('Failed to store event:', error);
            throw error;
        }

        logger.info(`✅ Event stored: ${event.type}`, { eventId: event.id, aggregateId: event.aggregateId });
    }

    async getEventStream(aggregateId) {
        // Check cache
        if (this.eventStreams.has(aggregateId)) {
            return this.eventStreams.get(aggregateId);
        }

        // Fetch from database
        const { data, error } = await supabase
            .from('event_store')
            .select('*')
            .eq('aggregate_id', aggregateId)
            .order('version', { ascending: true });

        if (error) {
            logger.error('Failed to fetch event stream:', error);
            return [];
        }

        this.eventStreams.set(aggregateId, data);
        return data;
    }

    async getAggregateState(aggregateId) {
        const events = await this.getEventStream(aggregateId);
        if (events.length === 0) {
            // Check snapshot for last known state when event stream is empty
            const snapshot = await this.getSnapshot(aggregateId);
            return snapshot ? snapshot.state : null;
        }

        // Apply events to build state
        let state = { id: aggregateId, version: 0 };
        for (const event of events) {
            state = this.applyEvent(state, event);
        }
        return state;
    }

    applyEvent(state, event) {
        switch (event.type) {
            case 'ORDER_CREATED':
                return {
                    ...state,
                    ...event.payload,
                    status: 'CREATED',
                    version: event.version
                };
            case 'ORDER_UPDATED':
                return {
                    ...state,
                    ...event.payload,
                    version: event.version
                };
            case 'ORDER_CANCELLED':
                return {
                    ...state,
                    status: 'CANCELLED',
                    cancelledAt: event.payload.cancelledAt,
                    reason: event.payload.reason,
                    version: event.version
                };
            case 'DRIVER_ASSIGNED':
                return {
                    ...state,
                    driverId: event.payload.driverId,
                    status: 'ASSIGNED',
                    version: event.version
                };
            default:
                return state;
        }
    }

    // ============ Snapshotting ============

    async checkSnapshot(aggregateId) {
        const events = await this.getEventStream(aggregateId);
        if (events.length >= this.snapshotThreshold) {
            const state = await this.getAggregateState(aggregateId);
            await this.takeSnapshot(aggregateId, state);
        }
    }

    async takeSnapshot(aggregateId, state) {
        this.snapshots.set(aggregateId, {
            state,
            timestamp: new Date().toISOString(),
            version: state.version
        });

        // Store in database
        const { error } = await supabase
            .from('snapshots')
            .upsert([{
                aggregate_id: aggregateId,
                state: state,
                version: state.version,
                timestamp: new Date().toISOString()
            }], {
                onConflict: 'aggregate_id'
            });

        if (error) {
            logger.error('Failed to store snapshot:', error);
        } else {
            logger.info(`✅ Snapshot taken for ${aggregateId}`);
            // Clear events up to snapshot
            this.eventStreams.set(aggregateId, []);
        }
    }

    async getSnapshot(aggregateId) {
        // Check cache
        if (this.snapshots.has(aggregateId)) {
            return this.snapshots.get(aggregateId);
        }

        // Fetch from database
        const { data, error } = await supabase
            .from('snapshots')
            .select('*')
            .eq('aggregate_id', aggregateId)
            .single();

        if (error) {
            return null;
        }

        this.snapshots.set(aggregateId, data);
        return data;
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

    async updateOrderReadModel(event) {
        const { data, error } = await supabase
            .from('orders_read_model')
            .upsert([{
                order_id: event.aggregateId,
                payload: event.payload,
                event_type: event.type,
                version: event.version,
                updated_at: new Date().toISOString()
            }], {
                onConflict: 'order_id'
            });

        if (error) {
            logger.error('Failed to update order read model:', error);
        }
    }

    async updateDriverReadModel(event) {
        const { data, error } = await supabase
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
            logger.error('Failed to update driver read model:', error);
        }
    }

    // ============ Kafka Publishing ============

    async publishEvents(events) {
        for (const event of events) {
            await this.publishEvent(event);
        }
    }

    async publishEvent(event) {
        const topic = this.getEventTopic(event.type);
        await kafka.publishEvent(topic, event, event.aggregateId);
        logger.info(`📤 Event published to Kafka: ${event.type}`);
    }

    getEventTopic(eventType) {
        const topicMap = {
            'ORDER_CREATED': TOPICS.ORDER_CREATED,
            'ORDER_UPDATED': TOPICS.ORDER_UPDATED,
            'ORDER_CANCELLED': TOPICS.ORDER_CANCELLED,
            'DRIVER_ASSIGNED': TOPICS.DRIVER_ASSIGNED
        };
        return topicMap[eventType] || eventType;
    }

    // ============ Query ============

    async getOrderReadModel(orderId) {
        const { data, error } = await supabase
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
        let query = supabase
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
            logger.error('Failed to get order list:', error);
            return [];
        }
        return data;
    }

    // ============ Stats ============

    async getEventStoreStats() {
        const { data: events, count: totalEvents } = await supabase
            .from('event_store')
            .select('event_type', { count: 'exact' });

        const { count: totalSnapshots } = await supabase
            .from('snapshots')
            .select('*', { count: 'exact', head: true });

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
}

export default new EventStore();