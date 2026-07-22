import express from 'express';
import chaosService from './chaos-service.js';
import logger from '../../api/src/middleware/logger.js';

const router = express.Router();

// Run chaos experiment
router.post('/chaos/experiment', async (req, res) => {
    try {
        const { type, config } = req.body;
        if (!type) {
            return res.status(400).json({
                success: false,
                error: 'experiment type required'
            });
        }

        const result = await chaosService.runExperiment(type, config);
        res.json({
            success: true,
            data: result,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Experiment error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get resilience score
router.get('/chaos/resilience', async (req, res) => {
    try {
        const score = await chaosService.getResilienceScore();
        const history = await chaosService.getResilienceHistory(10);
        res.json({
            success: true,
            data: {
                score,
                history,
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        logger.error('Resilience score error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Check system health
router.get('/chaos/health', async (req, res) => {
    try {
        const health = await chaosService.checkSystemHealth();
        res.json({
            success: true,
            data: health,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Health check error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get chaos stats
router.get('/chaos/stats', async (req, res) => {
    try {
        const stats = await chaosService.getChaosStats();
        res.json({
            success: true,
            data: stats,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Stats error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Schedule experiments
router.post('/chaos/schedule', async (req, res) => {
    try {
        await chaosService.scheduleExperiments();
        res.json({
            success: true,
            message: 'Experiments scheduled',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Schedule error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

export default router;