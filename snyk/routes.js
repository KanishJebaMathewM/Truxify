import express from 'express';
import snykService from './snyk.service.js';
import logger from '../backend/api/src/middleware/logger.js';
import { authenticate } from '../backend/api/src/middleware/auth.js';
import { requirePolicy } from '../backend/api/src/middleware/requirePolicy.js';
import { resolveSnykProjectPath } from './projectPath.js';

const router = express.Router();

// Every /snyk/* route uses the production SNYK_TOKEN to scan, read
// vulnerability data, and open fix PRs — authenticated admin-only.
router.use(authenticate, requirePolicy('snyk:manage'));

// Scan dependencies
/**
 * @openapi
 * /api/snyk/scan/dependencies:
 *   post:
 *     tags: [Snyk]
 *     summary: Scan project dependencies with Snyk
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
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
/**
 * @openapi
 * /api/snyk/scan/container:
 *   post:
 *     tags: [Snyk]
 *     summary: Scan a container image with Snyk
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               image:
 *                 type: string
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
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
/**
 * @openapi
 * /api/snyk/scan/iac:
 *   post:
 *     tags: [Snyk]
 *     summary: Scan infrastructure-as-code with Snyk
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
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
/**
 * @openapi
 * /api/snyk/scan/code:
 *   post:
 *     tags: [Snyk]
 *     summary: Scan source code with Snyk
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
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
/**
 * @openapi
 * /api/snyk/monitor:
 *   post:
 *     tags: [Snyk]
 *     summary: Monitor a project with Snyk
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
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
router.post('/snyk/monitor', async (req, res) => {
    try {
        const { path } = req.body;
        const projectPath = resolveSnykProjectPath(path || '.');
        const result = await snykService.monitorProject(projectPath);
        res.json({ success: true, data: result });
    } catch (error) {
        if (error.message.startsWith('Snyk project path')) {
            return res.status(400).json({ success: false, error: error.message });
        }
        logger.error('Monitor error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get vulnerabilities
/**
 * @openapi
 * /api/snyk/vulnerabilities/{projectId}:
 *   get:
 *     tags: [Snyk]
 *     summary: Get project vulnerabilities
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
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
/**
 * @openapi
 * /api/snyk/fix-pr/{projectId}:
 *   post:
 *     tags: [Snyk]
 *     summary: Create a Snyk fix pull request
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
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
/**
 * @openapi
 * /api/snyk/projects:
 *   get:
 *     tags: [Snyk]
 *     summary: List monitored Snyk projects
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
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
/**
 * @openapi
 * /api/snyk/stats:
 *   get:
 *     tags: [Snyk]
 *     summary: Get Snyk integration statistics
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
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
