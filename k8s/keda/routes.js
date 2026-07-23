import express from 'express';
import kedaService from './keda.service.js';
import logger from '../../api/src/middleware/logger.js';

const router = express.Router();

// Get API requests
router.get('/keda/metrics/requests', async (req, res) => {
    try {
        const result = await kedaService.getAPIRequests();
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Requests error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get API latency
router.get('/keda/metrics/latency', async (req, res) => {
    try {
        const result = await kedaService.getAPILatency();
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Latency error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get CPU usage
router.get('/keda/metrics/cpu', async (req, res) => {
    try {
        const { namespace, deployment } = req.query;
        if (!namespace || !deployment) {
            return res.status(400).json({
                success: false,
                error: 'namespace and deployment required'
            });
        }
        const result = await kedaService.getCPUUsage(namespace, deployment);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('CPU error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get memory usage
router.get('/keda/metrics/memory', async (req, res) => {
    try {
        const { namespace, deployment } = req.query;
        if (!namespace || !deployment) {
            return res.status(400).json({
                success: false,
                error: 'namespace and deployment required'
            });
        }
        const result = await kedaService.getMemoryUsage(namespace, deployment);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Memory error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get Kafka lag
router.get('/keda/metrics/kafka-lag', async (req, res) => {
    try {
        const { topic, consumerGroup } = req.query;
        if (!topic || !consumerGroup) {
            return res.status(400).json({
                success: false,
                error: 'topic and consumerGroup required'
            });
        }
        const result = await kedaService.getKafkaLag(topic, consumerGroup);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Kafka lag error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get autoscaling metrics
router.get('/keda/metrics/autoscale', async (req, res) => {
    try {
        const { namespace, deployment } = req.query;
        if (!namespace || !deployment) {
            return res.status(400).json({
                success: false,
                error: 'namespace and deployment required'
            });
        }
        const result = await kedaService.getAutoscalingMetrics(namespace, deployment);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Autoscale metrics error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get scale recommendation
router.get('/keda/scale/recommend', async (req, res) => {
    try {
        const { namespace, deployment } = req.query;
        if (!namespace || !deployment) {
            return res.status(400).json({
                success: false,
                error: 'namespace and deployment required'
            });
        }
        const result = await kedaService.getScaleRecommendation(namespace, deployment);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Scale recommendation error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get stats
router.get('/keda/stats', async (req, res) => {
    try {
        const stats = await kedaService.getStats();
        res.json({ success: true, data: stats });
    } catch (error) {
        logger.error('Stats error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;