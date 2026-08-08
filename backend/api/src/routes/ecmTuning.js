import express from 'express';
import { generateOtaTuningPayload } from '../services/ecmTuning.js';

const router = express.Router();

router.post('/tune-ota', (req, res) => {
    try {
        const { truckId, vin, topologyData } = req.body;

        if (!truckId || !topologyData) {
            return res.status(400).json({ error: 'truckId and topologyData parameters are required.' });
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
