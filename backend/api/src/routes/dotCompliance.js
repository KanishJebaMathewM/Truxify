import express from 'express';
import { evaluateDriverCompliance } from '../services/dotCompliance.js';
import { authenticate } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

router.post('/evaluate', authenticate, userLimiter, (req, res) => {
    try {
        const { driverId, cdlExpiration, medicalCardExpiration, hazmatExpiration, currentRoute } = req.body;

        if (!driverId) {
            return res.status(400).json({ error: 'driverId is required for compliance evaluation.' });
        }

        if (req.user.role !== 'admin' && driverId !== req.user.id) {
            return res.status(403).json({ error: 'Access denied. You can only evaluate your own compliance.' });
        }

        const report = evaluateDriverCompliance({
            driverId,
            cdlExpiration,
            medicalCardExpiration,
            hazmatExpiration,
            currentRoute
        });

        return res.json({
            success: true,
            data: report
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

export default router;
