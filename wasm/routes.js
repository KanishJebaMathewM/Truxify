import express from 'express';
import edgeRuntime from './edge-runtime.js';
import logger from '../../api/src/middleware/logger.js';

const router = express.Router();

// Calculate route
router.post('/wasm/route', async (req, res) => {
    try {
        const { origin, destination, weight, distance } = req.body;
        if (!origin || !destination) {
            return res.status(400).json({
                success: false,
                error: 'origin and destination required'
            });
        }
        
        const result = await edgeRuntime.calculateRoute({
            origin,
            destination,
            weight: weight || 0,
            distance: distance || 0
        });
        
        res.json({
            success: true,
            data: result,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Route calculation error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Process drivers
router.post('/wasm/drivers', async (req, res) => {
    try {
        const { drivers } = req.body;
        if (!drivers) {
            return res.status(400).json({
                success: false,
                error: 'drivers required'
            });
        }
        
        const result = await edgeRuntime.processDrivers(drivers);
        res.json({
            success: true,
            data: result,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Driver processing error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Optimize loads
router.post('/wasm/optimize', async (req, res) => {
    try {
        const { loads, capacity } = req.body;
        if (!loads || !capacity) {
            return res.status(400).json({
                success: false,
                error: 'loads and capacity required'
            });
        }
        
        const result = await edgeRuntime.optimizeLoads(loads, capacity);
        res.json({
            success: true,
            data: result,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Load optimization error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Calculate ETA
router.post('/wasm/eta', async (req, res) => {
    try {
        const { distance, speed, trafficFactor } = req.body;
        if (!distance || !speed) {
            return res.status(400).json({
                success: false,
                error: 'distance and speed required'
            });
        }
        
        const result = await edgeRuntime.calculateETA(distance, speed, trafficFactor || 0);
        res.json({
            success: true,
            data: result,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('ETA calculation error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Validate OTP
router.post('/wasm/otp', async (req, res) => {
    try {
        const { inputOTP, correctOTP } = req.body;
        if (!inputOTP || !correctOTP) {
            return res.status(400).json({
                success: false,
                error: 'inputOTP and correctOTP required'
            });
        }
        
        const result = await edgeRuntime.validateOTP(inputOTP, correctOTP);
        res.json({
            success: true,
            data: result,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('OTP validation error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get stats
router.get('/wasm/stats', async (req, res) => {
    try {
        const stats = await edgeRuntime.getFunctionStats();
        res.json({
            success: true,
            data: stats,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Stats error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;