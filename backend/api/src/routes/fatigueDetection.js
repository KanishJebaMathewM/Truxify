import express from 'express';
import { evaluateDriverFatigue } from '../services/fatigueDetection.js';
import { authenticate } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

router.post('/evaluate', authenticate, userLimiter, (req, res) => {
    try {
        const { driverId, biometricData, hosRemainingMinutes, currentLocation } = req.body;

        if (!driverId) {
            return res.status(400).json({ error: 'driverId parameter is required.' });
        }

        if (req.user.role !== 'admin' && driverId !== req.user.id) {
            return res.status(403).json({ error: 'Access denied. You can only evaluate your own fatigue status.' });
        }

        const assessment = evaluateDriverFatigue({
            driverId,
            biometricData,
            hosRemainingMinutes,
            currentLocation
        });

        return res.json({
            success: true,
            data: assessment
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

export default router;
