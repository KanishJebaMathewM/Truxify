import express from 'express';
import { calculateFairMarketValue } from '../services/pricingOracle.js';

const router = express.Router();

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPositiveFinite(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

router.post('/evaluate-load', (req, res) => {
    try {
        const { load, marketConditions } = req.body;

        if (!isPlainObject(load) || !isPositiveFinite(load.distanceMiles) || !isPositiveFinite(load.currentOfferedPayout)) {
            return res.status(400).json({
                error: 'Valid load payload with positive finite distanceMiles and currentOfferedPayout is required.'
            });
        }

        if (marketConditions !== undefined) {
            if (!isPlainObject(marketConditions)) {
                return res.status(400).json({ error: 'marketConditions must be an object when provided.' });
            }
            if (marketConditions.truckToLoadRatio !== undefined && !isPositiveFinite(marketConditions.truckToLoadRatio)) {
                return res.status(400).json({ error: 'truckToLoadRatio must be a finite number greater than 0.' });
            }
            if (marketConditions.localFuelPriceUSD !== undefined && !isPositiveFinite(marketConditions.localFuelPriceUSD)) {
                return res.status(400).json({ error: 'localFuelPriceUSD must be a finite number greater than 0.' });
            }
        }

        const valuation = calculateFairMarketValue(load, marketConditions);

        return res.json({
            success: true,
            data: valuation
        });
    } catch (error) {
        return res.status(error.statusCode || 500).json({ error: error.message });
    }
});

export default router;
