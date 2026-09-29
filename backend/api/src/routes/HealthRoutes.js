import express from 'express';
import logger from '../middleware/logger.js';

const router = express.Router();

router.get('/health', async (req, res) => {
  try {
    // Replaced console.log with structured logger.info
    logger.info({ requestId: req.id }, 'Health check probe requested');

    const healthStatus = {
      status: 'UP',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };

    res.status(200).json(healthStatus);
  } catch (err) {
    // Replaced console.error with structured logger.error
    logger.error({ err, requestId: req.id }, 'Health check probe failed');
    res.status(500).json({ status: 'DOWN', error: 'Internal Health Check Error' });
  }
});

router.get('/diagnostics', async (req, res) => {
  try {
    logger.info({ requestId: req.id }, 'Diagnostics check requested');

    const diagnosticsInfo = {
      memoryUsage: process.memoryUsage(),
      nodeVersion: process.version,
      env: process.env.NODE_ENV || 'development',
    };

    res.status(200).json(diagnosticsInfo);
  } catch (err) {
    logger.error({ err, requestId: req.id }, 'Diagnostics check failed');
    res.status(500).json({ status: 'ERROR', error: 'Internal Diagnostics Error' });
  }
});

export default router;
