import express from 'express';
import eventStore from './event-store.js';
import logger from '../../api/src/middleware/logger.js';

const router = express.Router();

// Handle command
router.post('/eventsourcing/command', async (req, res) => {
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
        logger.error('Command error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get order read model
router.get('/eventsourcing/order/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        const order = await eventStore.getOrderReadModel(orderId);
        res.json({
            success: true,
            data: order,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Get order error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get order list
router.get('/eventsourcing/orders', async (req, res) => {
    try {
        const { status, customerId, limit } = req.query;
        const orders = await eventStore.getOrderList({
            status,
            customerId,
            limit: parseInt(limit) || 100
        });
        res.json({
            success: true,
            data: orders,
            count: orders.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Get orders error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get event stream
router.get('/eventsourcing/stream/:aggregateId', async (req, res) => {
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
        logger.error('Get event stream error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get aggregate state
router.get('/eventsourcing/state/:aggregateId', async (req, res) => {
    try {
        const { aggregateId } = req.params;
        const state = await eventStore.getAggregateState(aggregateId);
        res.json({
            success: true,
            data: state,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Get state error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get stats
router.get('/eventsourcing/stats', async (req, res) => {
    try {
        const stats = await eventStore.getEventStoreStats();
        res.json({
            success: true,
            data: stats,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Get stats error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Rebuild projections
router.post('/eventsourcing/rebuild', async (req, res) => {
    try {
        // Rebuild all projections from events
        const { data: events } = await supabase
            .from('event_store')
            .select('*')
            .order('timestamp', { ascending: true });

        for (const event of events) {
            await eventStore.updateReadModel(event);
        }

        res.json({
            success: true,
            message: 'Projections rebuilt',
            count: events.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Rebuild error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;