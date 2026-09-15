import express from 'express';
import { calculateFairMarketValue } from '../services/pricingOracle.js';
import { authenticate } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

router.post('/evaluate-load', authenticate, userLimiter, (req, res) => {
    try {
        const { load, marketConditions } = req.body;

        if (!load || !load.distanceMiles || !load.currentOfferedPayout) {
            return res.status(400).json({ error: 'Valid load payload with distanceMiles and currentOfferedPayout is required.' });
        }

        const valuation = calculateFairMarketValue(load, marketConditions);

        return res.json({
            success: true,
            data: valuation
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

export default router;
