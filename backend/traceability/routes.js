import express from 'express';
import traceService from './trace.service.js';
import logger from '../../api/src/middleware/logger.js';

const router = express.Router();

// Create product
router.post('/trace/product', async (req, res) => {
    try {
        const result = await traceService.createProduct(req.body);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Product creation error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create shipment
router.post('/trace/shipment', async (req, res) => {
    try {
        const { productId, receiver, location } = req.body;
        if (!productId || !receiver) {
            return res.status(400).json({
                success: false,
                error: 'productId and receiver required'
            });
        }

        const result = await traceService.createShipment(productId, receiver, location);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Shipment creation error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update shipment status
router.post('/trace/shipment/update', async (req, res) => {
    try {
        const { shipmentId, status, location } = req.body;
        if (!shipmentId || !status) {
            return res.status(400).json({
                success: false,
                error: 'shipmentId and status required'
            });
        }

        const result = await traceService.updateShipmentStatus(shipmentId, status, location);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Shipment update error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Add custom event
router.post('/trace/event', async (req, res) => {
    try {
        const { productId, eventType, location, description } = req.body;
        if (!productId || !eventType) {
            return res.status(400).json({
                success: false,
                error: 'productId and eventType required'
            });
        }

        const result = await traceService.addCustomEvent(productId, eventType, location, description);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Custom event error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Verify product
router.post('/trace/verify', async (req, res) => {
    try {
        const { productId, isValid, notes } = req.body;
        if (!productId) {
            return res.status(400).json({
                success: false,
                error: 'productId required'
            });
        }

        const result = await traceService.verifyProduct(productId, isValid, notes);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Verification error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get product
router.get('/trace/product/:productId', async (req, res) => {
    try {
        const { productId } = req.params;
        const product = await traceService.getProduct(productId);
        res.json({ success: true, data: product });
    } catch (error) {
        logger.error('Product fetch error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get shipment
router.get('/trace/shipment/:shipmentId', async (req, res) => {
    try {
        const { shipmentId } = req.params;
        const shipment = await traceService.getShipment(shipmentId);
        res.json({ success: true, data: shipment });
    } catch (error) {
        logger.error('Shipment fetch error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get product trace
router.get('/trace/product/trace/:productId', async (req, res) => {
    try {
        const { productId } = req.params;
        const trace = await traceService.getProductTrace(productId);
        res.json({ success: true, data: trace });
    } catch (error) {
        logger.error('Product trace error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get stats
router.get('/trace/stats', async (req, res) => {
    try {
        const stats = await traceService.getTraceabilityStats();
        res.json({ success: true, data: stats });
    } catch (error) {
        logger.error('Stats error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;