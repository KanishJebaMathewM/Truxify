import express from 'express';
import RenderProfiler from './RenderProfiler.js';
import logger from '../../api/src/middleware/logger.js';

const router = express.Router();

// Initialize profiler
const profiler = new RenderProfiler();

// ============ Routes ============

// Create profile
router.post('/profiler/profile/create', (req, res) => {
    try {
        const { widgetName } = req.body;
        if (!widgetName) {
            return res.status(400).json({
                success: false,
                error: 'widgetName required'
            });
        }
        
        const profile = profiler.createProfile(widgetName);
        res.json({
            success: true,
            data: { widgetName, created: !!profile },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Create profile error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Stop profile
router.post('/profiler/profile/:widgetName/stop', (req, res) => {
    try {
        const { widgetName } = req.params;
        const stats = profiler.stopProfile(widgetName);
        
        if (!stats) {
            return res.status(404).json({
                success: false,
                error: 'Profile not found'
            });
        }
        
        res.json({
            success: true,
            data: stats,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Stop profile error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete profile
router.delete('/profiler/profile/:widgetName', (req, res) => {
    try {
        const { widgetName } = req.params;
        const success = profiler.deleteProfile(widgetName);
        
        res.json({
            success,
            data: { widgetName, deleted: success },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Delete profile error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get profile
router.get('/profiler/profile/:widgetName', (req, res) => {
    try {
        const { widgetName } = req.params;
        const stats = profiler.getWidgetStats(widgetName);
        
        if (!stats) {
            return res.status(404).json({
                success: false,
                error: 'Profile not found'
            });
        }
        
        res.json({
            success: true,
            data: stats,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Get profile error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get all profiles
router.get('/profiler/profiles', (req, res) => {
    try {
        const stats = profiler.getAllWidgetStats();
        res.json({
            success: true,
            data: stats,
            count: Object.keys(stats).length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Get profiles error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get active profiles
router.get('/profiler/profiles/active', (req, res) => {
    try {
        const profiles = profiler.getActiveProfiles();
        res.json({
            success: true,
            data: profiles.map(p => p.getStats()),
            count: profiles.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Get active profiles error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get global stats
router.get('/profiler/stats', (req, res) => {
    try {
        const stats = profiler.getGlobalStats();
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

// Get slowest widgets
router.get('/profiler/slowest', (req, res) => {
    try {
        const { limit } = req.query;
        const slowest = profiler.getSlowestWidgets(parseInt(limit) || 10);
        res.json({
            success: true,
            data: slowest,
            count: slowest.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Get slowest error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get most rendered widgets
router.get('/profiler/most-rendered', (req, res) => {
    try {
        const { limit } = req.query;
        const mostRendered = profiler.getMostRenderedWidgets(parseInt(limit) || 10);
        res.json({
            success: true,
            data: mostRendered,
            count: mostRendered.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Get most rendered error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Generate report
router.get('/profiler/report', (req, res) => {
    try {
        const report = profiler.generateReport();
        res.json({
            success: true,
            data: report,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Generate report error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Export report
router.get('/profiler/report/export', async (req, res) => {
    try {
        const report = await profiler.exportReport();
        res.json({
            success: true,
            data: report,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Export report error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Profile render
router.post('/profiler/render', (req, res) => {
    try {
        const { widgetName, cause, metadata } = req.body;
        if (!widgetName) {
            return res.status(400).json({
                success: false,
                error: 'widgetName required'
            });
        }
        
        const result = profiler.profileRender(
            widgetName,
            () => {
                // Simulate render
                return { rendered: true, widget: widgetName };
            },
            cause || 'manual',
            metadata || {}
        );
        
        res.json({
            success: true,
            data: result,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Profile render error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Profile layout
router.post('/profiler/layout', (req, res) => {
    try {
        const { widgetName, type } = req.body;
        if (!widgetName) {
            return res.status(400).json({
                success: false,
                error: 'widgetName required'
            });
        }
        
        const result = profiler.profileLayout(
            widgetName,
            () => {
                return { laidOut: true, widget: widgetName };
            },
            type || 'full'
        );
        
        res.json({
            success: true,
            data: result,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Profile layout error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Profile paint
router.post('/profiler/paint', (req, res) => {
    try {
        const { widgetName, region } = req.body;
        if (!widgetName) {
            return res.status(400).json({
                success: false,
                error: 'widgetName required'
            });
        }
        
        const result = profiler.profilePaint(
            widgetName,
            () => {
                return { painted: true, widget: widgetName };
            },
            region || 'full'
        );
        
        res.json({
            success: true,
            data: result,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Profile paint error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Control profiler
router.post('/profiler/control', (req, res) => {
    try {
        const { action } = req.body;
        
        switch (action) {
            case 'enable':
                profiler.enable();
                break;
            case 'disable':
                profiler.disable();
                break;
            case 'reset':
                profiler.reset();
                break;
            case 'clear':
                profiler.clearProfiles();
                break;
            default:
                return res.status(400).json({
                    success: false,
                    error: 'Invalid action'
                });
        }
        
        res.json({
            success: true,
            data: { action },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Control error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;