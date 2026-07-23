import express from 'express';
import wasiRuntime from './wasi-runtime.js';
import rateLimit from 'express-rate-limit';
import logger from '../../api/src/middleware/logger.js';

const router = express.Router();

// Rate limiters
const wasiActionLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    message: { success: false, error: 'Too many requests' }
});

// Load WASI module
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
router.post('/wasi/file/read', wasiActionLimiter, async (req, res) => {
    try {
        const { instanceId, path } = req.body;
        const content = await wasiRuntime.readFile(path);
        res.json({ success: true, data: { content } });
    } catch (error) {
        logger.error('Read error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/wasi/file/write', wasiActionLimiter, async (req, res) => {
    try {
        const { instanceId, path, content } = req.body;
        const result = await wasiRuntime.writeFile(path, content);
        res.json({ success: true, data: { result } });
    } catch (error) {
        logger.error('Write error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/wasi/file/list', wasiActionLimiter, async (req, res) => {
    try {
        const { instanceId, path } = req.body;
        const files = await wasiRuntime.listDirectory(path);
        res.json({ success: true, data: { files } });
    } catch (error) {
        logger.error('List error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Network operations
router.post('/wasi/http', wasiActionLimiter, async (req, res) => {
    try {
        const { url, method, headers, body } = req.body;
        const response = await wasiRuntime.httpRequest(url, method, headers, body);
        res.json({ success: true, data: response });
    } catch (error) {
        logger.error('HTTP error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Time operations
router.get('/wasi/time', async (req, res) => {
    try {
        const time = await wasiRuntime.getTime();
        const timeMs = await wasiRuntime.getTimeMs();
        res.json({ success: true, data: { time, timeMs } });
    } catch (error) {
        logger.error('Time error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// System operations
router.get('/wasi/system', async (req, res) => {
    try {
        const pid = await wasiRuntime.getProcessId();
        const cwd = await wasiRuntime.getCurrentDir();
        res.json({ success: true, data: { pid, cwd } });
    } catch (error) {
        logger.error('System error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Stats
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