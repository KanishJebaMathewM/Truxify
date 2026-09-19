import express from 'express';
import liquibaseService from './liquibase.service.js';
import logger from '../../backend/api/src/middleware/logger.js';
import { authenticate } from '../../backend/api/src/middleware/auth.js';
import { requirePolicy } from '../../backend/api/src/middleware/requirePolicy.js';

const router = express.Router();

// Run migrations (admin only)
/**
 * @openapi
 * /api/liquibase/migrate:
 *   post:
 *     tags: [Liquibase]
 *     summary: Run database migrations
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
router.post('/liquibase/migrate', authenticate, requirePolicy('liquibase:migrate'), async (req, res) => {
    try {
        const result = await liquibaseService.runMigrations();
        res.json({
            success: result.success,
            data: result,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Migration error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Rollback migrations (admin only)
/**
 * @openapi
 * /api/liquibase/rollback:
 *   post:
 *     tags: [Liquibase]
 *     summary: Rollback database migrations
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               count:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
router.post('/liquibase/rollback', authenticate, requirePolicy('liquibase:rollback'), async (req, res) => {
    try {
        const { count } = req.body;
        const result = await liquibaseService.rollback(count || 1);
        res.json({
            success: result.success,
            data: result,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Rollback error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get status (admin only)
/**
 * @openapi
 * /api/liquibase/status:
 *   get:
 *     tags: [Liquibase]
 *     summary: Get Liquibase migration status
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
router.get('/liquibase/status', authenticate, requirePolicy('liquibase:status'), async (req, res) => {
    try {
        const result = await liquibaseService.getStatus();
        res.json({
            success: result.success,
            data: result,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Status error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Validate changelog (admin only)
/**
 * @openapi
 * /api/liquibase/validate:
 *   post:
 *     tags: [Liquibase]
 *     summary: Validate the Liquibase changelog
 *     responses:
 *       200:
 *         description: Successful response
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
router.post('/liquibase/validate', authenticate, requirePolicy('liquibase:validate'), async (req, res) => {
    try {
        const result = await liquibaseService.validate();
        res.json({
            success: result.success,
            data: result,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('Validation error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;