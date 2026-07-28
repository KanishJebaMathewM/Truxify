import express from 'express';
import linkerdService from './linkerd.service.js';
import logger from '../../api/src/middleware/logger.js';

const router = express.Router();

// Get service metrics
router.get('/linkerd/metrics/:service', async (req, res) => {
    try {
        const { service } = req.params;
        const { namespace } = req.query;
        const metrics = await linkerdService.getServiceMetrics(service, namespace);
        res.json({ success: true, data: metrics });
    } catch (error) {
        logger.error('Metrics error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get endpoint metrics
router.get('/linkerd/endpoints', async (req, res) => {
    try {
        const metrics = await linkerdService.getEndpointMetrics();
        res.json({ success: true, data: metrics });
    } catch (error) {
        logger.error('Endpoints error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get top routes
router.get('/linkerd/top-routes', async (req, res) => {
    try {
        const { namespace, limit } = req.query;
        const routes = await linkerdService.getTopRoutes(namespace, parseInt(limit) || 10);
        res.json({ success: true, data: routes });
    } catch (error) {
        logger.error('Top routes error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get error rate
router.get('/linkerd/error-rate', async (req, res) => {
    try {
        const { namespace, deployment } = req.query;
        const rate = await linkerdService.getErrorRate(namespace, deployment);
        res.json({ success: true, data: { errorRate: rate } });
    } catch (error) {
        logger.error('Error rate error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get meshed status
router.get('/linkerd/meshed', async (req, res) => {
    try {
        const { namespace } = req.query;
        const status = await linkerdService.getMeshedStatus(namespace);
        res.json({ success: true, data: status });
    } catch (error) {
        logger.error('Meshed status error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get stats
router.get('/linkerd/stats', async (req, res) => {
    try {
        const stats = await linkerdService.getStats();
        res.json({ success: true, data: stats });
    } catch (error) {
        logger.error('Stats error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Health check
router.get('/linkerd/health', async (req, res) => {
    try {
        const health = await linkerdService.checkHealth();
        res.json({ success: true, data: health });
    } catch (error) {
        logger.error('Health check error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;