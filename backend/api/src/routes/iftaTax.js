import express from 'express';
import { generateIftaReport } from '../services/iftaTax.js';

const router = express.Router();

router.post('/generate-report', (req, res) => {
    try {
        const { truckId, quarter, year, waypoints, fuelPurchases } = req.body;

        if (!truckId) {
            return res.status(400).json({ error: 'truckId parameter is required.' });
        }

        if (!waypoints || !Array.isArray(waypoints)) {
            return res.status(400).json({ error: 'Array of GPS waypoints is required.' });
        }

        const report = generateIftaReport({
            truckId,
            quarter,
            year,
            waypoints,
            fuelPurchases
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
