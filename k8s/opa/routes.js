import express from 'express';
import opaService from './policy.service.js';
import logger from '../../api/src/middleware/logger.js';

const router = express.Router();

// Evaluate all policies
router.post('/opa/evaluate', async (req, res) => {
    try {
        const { input } = req.body;
        if (!input) {
            return res.status(400).json({
                success: false,
                error: 'input required'
            });
        }

        const result = await opaService.evaluateAll(input);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Evaluation error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Evaluate security policy
router.post('/opa/security', async (req, res) => {
    try {
        const { input } = req.body;
        if (!input) {
            return res.status(400).json({
                success: false,
                error: 'input required'
            });
        }

        const result = await opaService.evaluateSecurity(input);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Security evaluation error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Evaluate compliance policy
router.post('/opa/compliance', async (req, res) => {
    try {
        const { input } = req.body;
        if (!input) {
            return res.status(400).json({
                success: false,
                error: 'input required'
            });
        }

        const result = await opaService.evaluateCompliance(input);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Compliance evaluation error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Evaluate network policy
router.post('/opa/network', async (req, res) => {
    try {
        const { input } = req.body;
        if (!input) {
            return res.status(400).json({
                success: false,
                error: 'input required'
            });
        }

        const result = await opaService.evaluateNetwork(input);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Network evaluation error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Evaluate data policy
router.post('/opa/data', async (req, res) => {
    try {
        const { input } = req.body;
        if (!input) {
            return res.status(400).json({
                success: false,
                error: 'input required'
            });
        }

        const result = await opaService.evaluateData(input);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Data evaluation error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Check Kubernetes resource
router.post('/opa/kubernetes', async (req, res) => {
    try {
        const { resource } = req.body;
        if (!resource) {
            return res.status(400).json({
                success: false,
                error: 'resource required'
            });
        }

        const result = await opaService.checkKubernetesResource(resource);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Kubernetes check error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Deploy policy
router.post('/opa/policy', async (req, res) => {
    try {
        const { policyName, policyContent } = req.body;
        if (!policyName || !policyContent) {
            return res.status(400).json({
                success: false,
                error: 'policyName and policyContent required'
            });
        }

        const result = await opaService.deployPolicy(policyName, policyContent);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Policy deployment error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get policies
router.get('/opa/policies', async (req, res) => {
    try {
        const policies = await opaService.getPolicies();
        res.json({ success: true, data: policies });
    } catch (error) {
        logger.error('Get policies error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get stats
router.get('/opa/stats', async (req, res) => {
    try {
        const stats = await opaService.getStats();
        res.json({ success: true, data: stats });
    } catch (error) {
        logger.error('Stats error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;