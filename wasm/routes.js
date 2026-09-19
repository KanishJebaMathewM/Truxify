import express from 'express';
import edgeRuntime from './edge-runtime.js';
import logger from '../backend/api/src/middleware/logger.js';
import { authenticate } from '../backend/api/src/middleware/auth.js';
import { requirePolicy } from '../backend/api/src/middleware/requirePolicy.js';

const router = express.Router();

// Calculate route
/**
 * @openapi
 * /api/wasm/route:
 *   post:
 *     tags: [WASM]
 *     summary: Calculate a route using the WASM edge runtime
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               origin:
 *                 type: string
 *               destination:
 *                 type: string
 *               weight:
 *                 type: number
 *               distance:
 *                 type: number
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
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
/**
 * @openapi
 * /api/wasm/drivers:
 *   post:
 *     tags: [WASM]
 *     summary: Process drivers using the WASM edge runtime
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               drivers:
 *                 type: array
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
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
/**
 * @openapi
 * /api/wasm/optimize:
 *   post:
 *     tags: [WASM]
 *     summary: Optimize loads using the WASM edge runtime
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               loads:
 *                 type: array
 *               capacity:
 *                 type: number
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
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
/**
 * @openapi
 * /api/wasm/eta:
 *   post:
 *     tags: [WASM]
 *     summary: Calculate ETA using the WASM edge runtime
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               distance:
 *                 type: number
 *               speed:
 *                 type: number
 *               trafficFactor:
 *                 type: number
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
router.post('/wasm/eta', async (req, res) => {
    try {
        const { distance, speed, trafficFactor } = req.body;
        const numericDistance = Number(distance);
        const numericSpeed = Number(speed);
        const numericTrafficFactor = Number(trafficFactor || 0);

        if (!Number.isFinite(numericDistance) || numericDistance <= 0) {
            return res.status(400).json({
                success: false,
                error: 'distance must be a positive number'
            });
        }
        if (!Number.isFinite(numericSpeed) || numericSpeed <= 0) {
            return res.status(400).json({
                success: false,
                error: 'speed must be a positive number'
            });
        }
        if (!Number.isFinite(numericTrafficFactor) || numericTrafficFactor >= 1) {
            return res.status(400).json({
                success: false,
                error: 'trafficFactor must be a number less than 1'
            });
        }
        
        const result = await edgeRuntime.calculateETA(numericDistance, numericSpeed, numericTrafficFactor);
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

// Validate OTP removed (#6331): it accepted the reference value from the
// client (validate_otp => input === correct), a trivially bypassable OTP
// validator on the public API. OTP validation must happen server-side
// against a stored, hashed OTP — never a client-supplied reference.

// Get stats
/**
 * @openapi
 * /api/wasm/stats:
 *   get:
 *     tags: [WASM]
 *     summary: Get WASM runtime statistics
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
router.get('/wasm/stats', authenticate, requirePolicy('wasm:manage'), async (req, res) => {
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