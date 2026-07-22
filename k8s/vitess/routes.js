import express from 'express';
import vitessService from './vitess.service.js';
import logger from '../../api/src/middleware/logger.js';

const router = express.Router();

// Insert order
router.post('/vitess/order', async (req, res) => {
    try {
        const result = await vitessService.insertOrder(req.body);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Insert order error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get order
router.get('/vitess/order/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        const result = await vitessService.getOrder(orderId);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Get order error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get orders by customer
router.get('/vitess/orders/customer/:customerId', async (req, res) => {
    try {
        const { customerId } = req.params;
        const { limit } = req.query;
        const result = await vitessService.getOrdersByCustomer(customerId, parseInt(limit) || 100);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Get orders error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update order status
router.put('/vitess/order/:orderId/status', async (req, res) => {
    try {
        const { orderId } = req.params;
        const { status } = req.body;
        if (!status) return res.status(400).json({ success: false, error: 'status required' });

        const result = await vitessService.updateOrderStatus(orderId, status);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Update order error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Insert driver
router.post('/vitess/driver', async (req, res) => {
    try {
        const result = await vitessService.insertDriver(req.body);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Insert driver error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get driver
router.get('/vitess/driver/:driverId', async (req, res) => {
    try {
        const { driverId } = req.params;
        const result = await vitessService.getDriver(driverId);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Get driver error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Insert payment
router.post('/vitess/payment', async (req, res) => {
    try {
        const result = await vitessService.insertPayment(req.body);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Insert payment error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get aggregated stats
router.get('/vitess/stats', async (req, res) => {
    try {
        const stats = await vitessService.getAggregatedStats();
        const shardStats = await vitessService.getShardStats();
        const queryStats = await vitessService.getQueryStats();
        res.json({
            success: true,
            data: {
                aggregated: stats,
                shards: shardStats,
                queries: queryStats
            }
        });
    } catch (error) {
        logger.error('Get stats error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;