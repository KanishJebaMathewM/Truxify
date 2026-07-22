import express from 'express';
import liquibaseService from './liquibase.service.js';
import logger from '../../api/src/middleware/logger.js';

const router = express.Router();

// Run migrations
router.post('/liquibase/migrate', async (req, res) => {
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

// Rollback migrations
router.post('/liquibase/rollback', async (req, res) => {
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

// Get status
router.get('/liquibase/status', async (req, res) => {
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

// Validate changelog
router.post('/liquibase/validate', async (req, res) => {
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