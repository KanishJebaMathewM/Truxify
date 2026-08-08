import express from 'express';
import { evaluateDriverCompliance } from '../services/dotCompliance.js';

const router = express.Router();

router.post('/evaluate', (req, res) => {
    try {
        const { driverId, cdlExpiration, medicalCardExpiration, hazmatExpiration, currentRoute } = req.body;

        if (!driverId) {
            return res.status(400).json({ error: 'driverId is required for compliance evaluation.' });
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
