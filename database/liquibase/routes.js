import express from 'express';
import liquibaseService from './liquibase.service.js';
import logger from '../../backend/api/src/middleware/logger.js';
import { authenticate } from '../../backend/api/src/middleware/auth.js';
import { requirePolicy } from '../../backend/api/src/middleware/requirePolicy.js';

const router = express.Router();

// Run migrations (admin only)
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