import express from 'express';
import { evaluateReeferPrecooling } from '../services/reeferPrecool.js';

const router = express.Router();

router.post('/evaluate-precool', (req, res) => {
    try {
        const { reeferId, etaMinutes, targetCargoTempF, currentReeferTempF, ambientWeatherTempF } = req.body;

        if (!reeferId) {
            return res.status(400).json({ error: 'reeferId parameter is required.' });
        }

        const evaluation = evaluateReeferPrecooling({
            reeferId,
            etaMinutes,
            targetCargoTempF,
            currentReeferTempF,
            ambientWeatherTempF
        });

        return res.json({
            success: true,
            data: evaluation
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

export default router;
