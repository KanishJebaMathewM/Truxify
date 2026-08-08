import express from 'express';
import { evaluateDriverFatigue } from '../services/fatigueDetection.js';

const router = express.Router();

router.post('/evaluate', (req, res) => {
    try {
        const { driverId, biometricData, hosRemainingMinutes, currentLocation } = req.body;

        if (!driverId) {
            return res.status(400).json({ error: 'driverId parameter is required.' });
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
