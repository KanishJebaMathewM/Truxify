import express from 'express';
import snykService from './snyk.service.js';
import logger from '../../api/src/middleware/logger.js';

const router = express.Router();

// Scan dependencies
router.post('/snyk/scan/dependencies', async (req, res) => {
    try {
        const { path } = req.body;
        const result = await snykService.scanDependencies(path || '.');
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Dependency scan error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Scan container
router.post('/snyk/scan/container', async (req, res) => {
    try {
        const { image } = req.body;
        if (!image) {
            return res.status(400).json({
                success: false,
                error: 'image required'
            });
        }
        const result = await snykService.scanContainer(image);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Container scan error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Scan IaC
router.post('/snyk/scan/iac', async (req, res) => {
    try {
        const { path } = req.body;
        if (!path) {
            return res.status(400).json({
                success: false,
                error: 'path required'
            });
        }
        const result = await snykService.scanIaC(path);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('IaC scan error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Scan code
router.post('/snyk/scan/code', async (req, res) => {
    try {
        const { path } = req.body;
        if (!path) {
            return res.status(400).json({
                success: false,
                error: 'path required'
            });
        }
        const result = await snykService.scanCode(path);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Code scan error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Monitor project
router.post('/snyk/monitor', async (req, res) => {
    try {
        const { path } = req.body;
        const result = await snykService.monitorProject(path || '.');
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Monitor error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get vulnerabilities
router.get('/snyk/vulnerabilities/:projectId', async (req, res) => {
    try {
        const { projectId } = req.params;
        const result = await snykService.getVulnerabilities(projectId);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Vulnerabilities error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create fix PR
router.post('/snyk/fix-pr/:projectId', async (req, res) => {
    try {
        const { projectId } = req.params;
        const result = await snykService.createFixPR(projectId);
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Fix PR error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get projects
router.get('/snyk/projects', async (req, res) => {
    try {
        const result = await snykService.getProjects();
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Projects error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get stats
router.get('/snyk/stats', async (req, res) => {
    try {
        const stats = await snykService.getStats();
        res.json({ success: true, data: stats });
    } catch (error) {
        logger.error('Stats error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;