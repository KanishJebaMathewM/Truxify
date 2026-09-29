import express from 'express';
import wasiRuntime from './wasi-runtime.js';
import rateLimit from 'express-rate-limit';
import logger from '../backend/api/src/middleware/logger.js';
import { authenticate } from '../backend/api/src/middleware/auth.js';
import { requirePolicy } from '../backend/api/src/middleware/requirePolicy.js';

const router = express.Router();

// The WASI runtime can read files, make HTTP requests and instantiate WASM —
// keep it isolated from the public API: authenticated admin-only.
router.use(authenticate, requirePolicy('wasi:manage'));

// Rate limiters
const wasiActionLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    message: { success: false, error: 'Too many requests' }
});

// Load WASI module
/**
 * @openapi
 * /api/wasi/load:
 *   post:
 *     tags: [WASI]
 *     summary: Load a WASI module
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               wasmPath:
 *                 type: string
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
router.post('/wasi/load', wasiActionLimiter, async (req, res) => {
    try {
        const { wasmPath } = req.body;
        if (!wasmPath) {
            return res.status(400).json({ success: false, error: 'wasmPath required' });
        }
        
        const instanceId = await wasiRuntime.loadWasiModule(wasmPath);
        res.json({ success: true, data: { instanceId } });
    } catch (error) {
        logger.error('Load error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// File operations
/**
 * @openapi
 * /api/wasi/file/read:
 *   post:
 *     tags: [WASI]
 *     summary: Read a file through a WASI instance
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               instanceId:
 *                 type: string
 *               path:
 *                 type: string
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
router.post('/wasi/file/read', wasiActionLimiter, async (req, res) => {
    try {
        const { instanceId, path } = req.body;
        const content = await wasiRuntime.readFile(instanceId, path);
        res.json({ success: true, data: { content } });
    } catch (error) {
        logger.error('Read error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @openapi
 * /api/wasi/file/write:
 *   post:
 *     tags: [WASI]
 *     summary: Write a file through a WASI instance
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               instanceId:
 *                 type: string
 *               path:
 *                 type: string
 *               content:
 *                 type: string
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
router.post('/wasi/file/write', wasiActionLimiter, async (req, res) => {
    try {
        const { instanceId, path, content } = req.body;
        const result = await wasiRuntime.writeFile(instanceId, path, content);
        res.json({ success: true, data: { result } });
    } catch (error) {
        logger.error('Write error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @openapi
 * /api/wasi/file/list:
 *   post:
 *     tags: [WASI]
 *     summary: List a directory through a WASI instance
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               instanceId:
 *                 type: string
 *               path:
 *                 type: string
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
router.post('/wasi/file/list', wasiActionLimiter, async (req, res) => {
    try {
        const { instanceId, path } = req.body;
        const files = await wasiRuntime.listDirectory(instanceId, path);
        res.json({ success: true, data: { files } });
    } catch (error) {
        logger.error('List error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Network operations
/**
 * @openapi
 * /api/wasi/http:
 *   post:
 *     tags: [WASI]
 *     summary: Perform an HTTP request through a WASI instance
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               instanceId:
 *                 type: string
 *               url:
 *                 type: string
 *               method:
 *                 type: string
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
router.post('/wasi/http', wasiActionLimiter, async (req, res) => {
    try {
        const { instanceId, url, method, headers, body } = req.body;
        const response = await wasiRuntime.httpRequest(instanceId, url, method, headers, body);
        res.json({ success: true, data: response });
    } catch (error) {
        logger.error('HTTP error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Time operations
/**
 * @openapi
 * /api/wasi/time:
 *   get:
 *     tags: [WASI]
 *     summary: Get WASI time information
 *     parameters:
 *       - in: query
 *         name: instanceId
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
router.get('/wasi/time', async (req, res) => {
    try {
        const { instanceId } = req.query;
        const time = await wasiRuntime.getTime(instanceId);
        const timeMs = await wasiRuntime.getTimeMs(instanceId);
        res.json({ success: true, data: { time, timeMs } });
    } catch (error) {
        logger.error('Time error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// System operations
/**
 * @openapi
 * /api/wasi/system:
 *   get:
 *     tags: [WASI]
 *     summary: Get WASI process/system information
 *     parameters:
 *       - in: query
 *         name: instanceId
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
router.get('/wasi/system', async (req, res) => {
    try {
        const { instanceId } = req.query;
        const pid = await wasiRuntime.getProcessId(instanceId);
        const cwd = await wasiRuntime.getCurrentDir(instanceId);
        res.json({ success: true, data: { pid, cwd } });
    } catch (error) {
        logger.error('System error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Stats
/**
 * @openapi
 * /api/wasi/stats:
 *   get:
 *     tags: [WASI]
 *     summary: Get WASI runtime statistics
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
router.get('/wasi/stats', async (req, res) => {
    try {
        const stats = await wasiRuntime.getStats();
        res.json({ success: true, data: stats });
    } catch (error) {
        logger.error('Stats error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;