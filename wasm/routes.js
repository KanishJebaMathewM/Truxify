import express from 'express';
import rateLimit from 'express-rate-limit';
import edgeRuntime from './edge-runtime.js';
import logger from '../backend/api/src/middleware/logger.js';
import { authenticate } from '../backend/api/src/middleware/auth.js';
import { requirePolicy } from '../backend/api/src/middleware/requirePolicy.js';

const router = express.Router();

// The WASM edge runtime executes arbitrary compute per request — a fresh
// worker thread per call (or synchronous fallback on the event loop when no
// .wasm binary is deployed) — so it is isolated from the public API like the
// sibling subsystem routers (ebpf/wasi/snyk): authenticated admin-only and
// rate-limited.
router.use(authenticate, requirePolicy('wasm:manage'));

// Rate limiter for the compute endpoints
const wasmActionLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    message: { success: false, error: 'Too many requests' },
    standardHeaders: true,
    legacyHeaders: false,
});

router.use(wasmActionLimiter);

// Bound attacker-sized bodies: each entry is processed on a worker thread or
// synchronously on the event loop, so unbounded arrays enable CPU exhaustion.
const MAX_DRIVERS = 1000;
const MAX_LOADS = 1000;

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
        if (!Array.isArray(drivers)) {
            return res.status(400).json({
                success: false,
                error: 'drivers must be an array'
            });
        }
        if (drivers.length > MAX_DRIVERS) {
            return res.status(400).json({
                success: false,
                error: `drivers array too large (max ${MAX_DRIVERS})`
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
        if (!Array.isArray(loads)) {
            return res.status(400).json({
                success: false,
                error: 'loads must be an array'
            });
        }
        if (capacity === undefined || capacity === null) {
            return res.status(400).json({
                success: false,
                error: 'loads and capacity required'
            });
        }
        if (loads.length > MAX_LOADS) {
            return res.status(400).json({
                success: false,
                error: `loads array too large (max ${MAX_LOADS})`
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