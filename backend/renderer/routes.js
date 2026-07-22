import express from 'express';
import DirtyRenderer from './DirtyRenderer.js';
import logger from '../../api/src/middleware/logger.js';

const router = express.Router();

// Initialize renderer
const renderer = new DirtyRenderer(80, 24);

// ============ Routes ============

// Render current frame
router.get('/render/frame', (req, res) => {
    try {
        const output = renderer.render();
        res.json({
            success: true,
            data: {
                output: output,
                length: output.length,
                stats: renderer.getStats()
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Render error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Set pixel
router.post('/render/pixel', (req, res) => {
    try {
        const { x, y, char, fg, bg, style } = req.body;
        if (x === undefined || y === undefined || !char) {
            return res.status(400).json({
                success: false,
                error: 'x, y, and char required'
            });
        }
        
        const changed = renderer.setPixel(x, y, char, fg, bg, style);
        res.json({
            success: true,
            data: { changed },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Set pixel error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Set region
router.post('/render/region', (req, res) => {
    try {
        const { x, y, width, height, data } = req.body;
        if (x === undefined || y === undefined || !width || !height || !data) {
            return res.status(400).json({
                success: false,
                error: 'x, y, width, height, and data required'
            });
        }
        
        const changed = renderer.setRegion(x, y, width, height, data);
        res.json({
            success: true,
            data: { changed },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Set region error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Fill frame
router.post('/render/fill', (req, res) => {
    try {
        const { char, fg, bg, style } = req.body;
        const changed = renderer.fill(char || ' ', fg, bg, style);
        res.json({
            success: true,
            data: { changed },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Fill error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Clear frame
router.post('/render/clear', (req, res) => {
    try {
        const { char } = req.body;
        const changed = renderer.clear(char);
        res.json({
            success: true,
            data: { changed },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Clear error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get stats
router.get('/render/stats', (req, res) => {
    try {
        const stats = renderer.getStats();
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

// Resize renderer
router.post('/render/resize', (req, res) => {
    try {
        const { width, height } = req.body;
        if (!width || !height) {
            return res.status(400).json({
                success: false,
                error: 'width and height required'
            });
        }
        
        renderer.resize(width, height);
        res.json({
            success: true,
            message: 'Renderer resized',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Resize error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Enable/disable renderer
router.post('/render/enable', (req, res) => {
    try {
        const { enabled } = req.body;
        if (enabled === false) {
            renderer.disable();
        } else {
            renderer.enable();
        }
        res.json({
            success: true,
            data: { enabled: renderer.isEnabled },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Enable error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;