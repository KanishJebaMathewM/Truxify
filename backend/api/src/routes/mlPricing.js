/**
 * ML Pricing Routes
 * Exposes endpoints for demand prediction and pricing search.
 * Protected by strict rate limiting and price obfuscation.
 */
import express from 'express';
import { strictMlRateLimiter } from '../middleware/mlRateLimiter.js';
import { applyPriceObfuscation } from '../services/priceObfuscation.js';
import logger from '../middleware/logger.js';

const router = express.Router();

/**
 * Validate request body for ML endpoints
 */
function validateMlRequest(req, res, next) {
    const { origin, destination } = req.body;
    if (!origin || typeof origin !== 'string' || origin.trim().length < 3) {
        return res.status(400).json({ error: 'Invalid or missing origin. Must be a string of at least 3 characters.' });
    }
    if (!destination || typeof destination !== 'string' || destination.trim().length < 3) {
        return res.status(400).json({ error: 'Invalid or missing destination. Must be a string of at least 3 characters.' });
    }
    next();
}

/**
 * @route POST /api/v1/ml/predict-demand
 * @desc Predicts demand for a specific route and time.
 * @access Public (with strict rate limits) or Private
 */
router.post('/predict-demand', strictMlRateLimiter, validateMlRequest, async (req, res) => {
    try {
        const { origin, destination, date, cargoType } = req.body;

        // TODO: Replace with actual ML service call
        // const mlResponse = await mlService.predictDemand({ origin, destination, date, cargoType });
        const mockMlResponse = {
            demandScore: 0.85,
            estimatedPrice: 15000,
            confidence: 0.92
        };

        // Apply obfuscation to the estimated price
        const userId = req.user?.id || null;
        const finalEstimatedPrice = await applyPriceObfuscation(mockMlResponse.estimatedPrice, userId);

        res.json({
            success: true,
            data: {
                ...mockMlResponse,
                estimatedPrice: finalEstimatedPrice
            }
        });
    } catch (err) {
        logger.error({ err, body: req.body }, '[MLPricing] Error in predict-demand endpoint');
        res.status(500).json({ error: 'Internal server error while predicting demand.' });
    }
});

/**
 * @route POST /api/v1/ml/search
 * @desc Searches for available loads/trucks with ML-optimized pricing.
 * @access Public (with strict rate limits) or Private
 */
router.post('/search', strictMlRateLimiter, validateMlRequest, async (req, res) => {
    try {
        const { origin, destination, vehicleType, maxPrice } = req.body;

        // TODO: Replace with actual ML service call
        // const mlResponse = await mlService.searchLoads({ origin, destination, vehicleType, maxPrice });
        const mockMlResponse = {
            results: [
                { id: 'load-1', price: 12000, distance: 450 },
                { id: 'load-2', price: 13500, distance: 460 }
            ]
        };

        // Apply obfuscation to each result's price
        const userId = req.user?.id || null;
        const obfuscatedResults = await Promise.all(
            mockMlResponse.results.map(async (item) => {
                const obfuscatedPrice = await applyPriceObfuscation(item.price, userId);
                return { ...item, price: obfuscatedPrice };
            })
        );

        res.json({
            success: true,
            data: {
                results: obfuscatedResults
            }
        });
    } catch (err) {
        logger.error({ err, body: req.body }, '[MLPricing] Error in search endpoint');
        res.status(500).json({ error: 'Internal server error while searching.' });
    }
});

export default router;
