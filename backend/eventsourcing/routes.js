import express from 'express';
import eventStore from './event-store.js';
import { supabase } from '../api/src/config/db.js';
import logger from '../api/src/middleware/logger.js';
import { EventStoreError } from './errors.js';
import { authenticate, requireRole } from '../api/src/middleware/auth.js';

const router = express.Router();

const REBUILD_BATCH_SIZE = 1000;

/**
 * Controlled error response: typed event-store errors are translated to their
 * HTTP status with a public message; everything else collapses to a generic
 * 500 so SQL errors, Supabase internals and stack traces never reach clients.
 */
function sendEventStoreError(res, error, fallbackMessage) {
    logger.error(fallbackMessage, error);
    if (error instanceof EventStoreError) {
        return res.status(error.httpStatus).json({
            success: false,
            error: error.message,
            code: error.code,
        });
    }
    return res.status(500).json({
        success: false,
        error: fallbackMessage,
        code: 'EVENT_STORE_INTERNAL_ERROR',
    });
}

// Handle command
router.post('/eventsourcing/command', authenticate, requireRole(['admin']), async (req, res) => {
    try {
        const { type, aggregateId, payload } = req.body;
        if (!type) {
            return res.status(400).json({ success: false, error: 'command type required' });
        }

        const result = await eventStore.handleCommand({
            type,
            aggregateId: aggregateId || `agg_${Date.now()}`,
            payload
        });

        res.json({
            success: true,
            data: result,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        sendEventStoreError(res, error, 'Command processing failed');
    }
});

// Get order read model
router.get('/eventsourcing/order/:orderId', authenticate, async (req, res) => {
    try {
        const { orderId } = req.params;
        const order = await eventStore.getOrderReadModel(orderId);
        res.json({
            success: true,
            data: order,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        sendEventStoreError(res, error, 'Get order error');
    }
});

// Get order list
router.get('/eventsourcing/orders', authenticate, async (req, res) => {
    try {
        const { status, customerId, limit } = req.query;
        const orders = await eventStore.getOrderList({
            status,
            customerId,
            limit: parseInt(limit, 10) || 100
        });
        res.json({
            success: true,
            data: orders,
            count: orders.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        sendEventStoreError(res, error, 'Get orders error');
    }
});

// Get event stream
router.get('/eventsourcing/stream/:aggregateId', authenticate, async (req, res) => {
    try {
        const { aggregateId } = req.params;
        const events = await eventStore.getEventStream(aggregateId);
        res.json({
            success: true,
            data: events,
            count: events.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        sendEventStoreError(res, error, 'Get event stream error');
    }
});

// Get aggregate state
router.get('/eventsourcing/state/:aggregateId', authenticate, async (req, res) => {
    try {
        const { aggregateId } = req.params;
        const state = await eventStore.getAggregateState(aggregateId);
        res.json({
            success: true,
            data: state,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        sendEventStoreError(res, error, 'Get state error');
    }
});

// Get stats
router.get('/eventsourcing/stats', authenticate, requireRole(['admin']), async (req, res) => {
    try {
        const stats = await eventStore.getEventStoreStats();
        res.json({
            success: true,
            data: stats,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        sendEventStoreError(res, error, 'Get stats error');
    }
});

// Rebuild projections with one bounded page and one aggregate state in memory.
// Orders need aggregate/version order; drivers need global assignment chronology.
async function* rebuildPages(driverAssignmentsOnly = false) {
    let offset = 0;
    while (true) {
        let query = supabase.from('event_store').select('*');
        query = driverAssignmentsOnly
            ? query.eq('event_type', 'DRIVER_ASSIGNED').order('timestamp', { ascending: true })
            : query.order('aggregate_id', { ascending: true }).order('version', { ascending: true });
        const { data, error } = await query
            .order('event_id', { ascending: true })
            .range(offset, offset + REBUILD_BATCH_SIZE - 1);
        if (error) throw error;
        if (!data?.length) return;
        yield data;
        if (data.length < REBUILD_BATCH_SIZE) return;
        offset += REBUILD_BATCH_SIZE;
    }
}

router.post('/eventsourcing/rebuild', authenticate, requireRole(['admin']), async (req, res) => {
    try {
        const result = await eventStore.rebuildProjectionsFromPages(rebuildPages(), rebuildPages(true));

        res.json({
            success: true,
            message: 'Projections rebuilt',
            ...result,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        sendEventStoreError(res, error, 'Projection rebuild failed');
    }
});

export default router;
