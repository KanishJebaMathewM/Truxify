import express from 'express';
import { generateOtaTuningPayload } from '../services/ecmTuning.js';
import { authenticate } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

router.post('/tune-ota', authenticate, userLimiter, (req, res) => {
    try {
        const { truckId, vin, topologyData } = req.body;

        if (!truckId || !topologyData) {
            return res.status(400).json({ error: 'truckId and topologyData parameters are required.' });
        }

        if (req.user.role !== 'admin' && req.user.role !== 'driver') {
            return res.status(403).json({ error: 'Access denied. Only drivers or admins can generate OTA tuning payloads.' });
        }

        const otaPayload = generateOtaTuningPayload({
            truckId,
            vin,
            topologyData
        });

        return res.json({
            success: true,
            data: otaPayload
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

export default router;
