import express from 'express';
import kedaService from '../services/kedaService.js';
import logger from '../middleware/logger.js';
import { validateQuery } from '../middleware/validate.js';
import { kedaNamespaceQuerySchema, kedaKafkaLagQuerySchema } from '../validation/requestSchemas.js';

const router = express.Router();

/**
 * Wraps an async route handler so the duplicated catch block
 * ({ status 500, success: false, error }) lives in one place.
 */
const asyncRoute = (label) => (handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (error) {
    logger.error(`${label} error:`, error);
    res.status(500).json({ success: false, error: error?.message ?? String(error) });
  }
};

router.get('/keda/metrics/requests', asyncRoute('Requests')(async (_req, res) => {
    const result = await kedaService.getAPIRequests();
    if (!result.success) return res.status(502).json(result);
    res.json({ success: true, data: result });
}));

router.get('/keda/metrics/latency', asyncRoute('Latency')(async (_req, res) => {
    const result = await kedaService.getAPILatency();
    if (!result.success) return res.status(502).json(result);
    res.json({ success: true, data: result });
}));

router.get('/keda/metrics/cpu', validateQuery(kedaNamespaceQuerySchema), asyncRoute('CPU')(async (req, res) => {
    const { namespace, deployment } = req.query;
    const result = await kedaService.getCPUUsage(namespace, deployment);
    if (!result.success) return res.status(502).json(result);
    res.json({ success: true, data: result });
}));

router.get('/keda/metrics/memory', validateQuery(kedaNamespaceQuerySchema), asyncRoute('Memory')(async (req, res) => {
    const { namespace, deployment } = req.query;
    const result = await kedaService.getMemoryUsage(namespace, deployment);
    if (!result.success) return res.status(502).json(result);
    res.json({ success: true, data: result });
}));

router.get('/keda/metrics/kafka-lag', validateQuery(kedaKafkaLagQuerySchema), asyncRoute('Kafka lag')(async (req, res) => {
    const { topic, consumerGroup } = req.query;
    const result = await kedaService.getKafkaLag(topic, consumerGroup);
    if (!result.success) {
        return res.status(502).json({ success: false, error: result.error || 'Kafka lag metric unavailable' });
    }
    res.json({ success: true, data: result });
}));

router.get('/keda/metrics/autoscale', validateQuery(kedaNamespaceQuerySchema), asyncRoute('Autoscale metrics')(async (req, res) => {
    const { namespace, deployment } = req.query;
    const result = await kedaService.getAutoscalingMetrics(namespace, deployment);
    if (!result.success) {
        return res.status(502).json(result);
    }
    res.json({ success: true, data: result });
}));

router.get('/keda/scale/recommend', validateQuery(kedaNamespaceQuerySchema), asyncRoute('Scale recommendation')(async (req, res) => {
    const { namespace, deployment } = req.query;
    const result = await kedaService.getScaleRecommendation(namespace, deployment);
    if (!result.success) {
        return res.status(502).json(result);
    }
    res.json({ success: true, data: result });
}));

router.get('/keda/stats', asyncRoute('Stats')(async (_req, res) => {
    const stats = await kedaService.getStats();
    res.json({ success: true, data: stats });
}));

export default router;