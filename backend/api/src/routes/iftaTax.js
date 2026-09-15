import express from 'express';
import { generateIftaReport } from '../services/iftaTax.js';
import { authenticate } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

router.post('/generate-report', authenticate, userLimiter, (req, res) => {
    try {
        const { truckId, quarter, year, waypoints, fuelPurchases } = req.body;

        if (!truckId) {
            return res.status(400).json({ error: 'truckId parameter is required.' });
        }

        if (req.user.role !== 'admin' && req.user.role !== 'driver') {
            return res.status(403).json({ error: 'Access denied. Only drivers or admins can generate IFTA reports.' });
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
