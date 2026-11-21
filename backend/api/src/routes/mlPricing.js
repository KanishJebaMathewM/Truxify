/**
 * ML Pricing Routes
 * Exposes endpoints for demand prediction and pricing search.
 * Protected by strict rate limiting and price obfuscation.
 */
import express from 'express';
import axios from 'axios';
import { strictMlRateLimiter } from '../middleware/mlRateLimiter.js';
import { applyPriceObfuscation } from '../services/priceObfuscation.js';
import logger from '../middleware/logger.js';

const router = express.Router();

const getMlBaseUrl = () => process.env.ML_ENGINE_URL || process.env.ML_SERVICE_URL || 'http://localhost:8001';
const getMlTimeoutMs = () => parseInt(process.env.ML_REQUEST_TIMEOUT_MS || '5000', 10);

/**
 * Standard headers for ML microservice requests
 */
function getMlHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    const apiKey = (process.env.ML_API_KEY || '').trim();
    if (apiKey) {
        headers['X-API-Key'] = apiKey;
        headers['Authorization'] = `Bearer ${apiKey}`;
    }
    return headers;
}

/**
 * Validate request body for ML endpoints
 */
function validateMlRequest(req, res, next) {
    const { origin, destination } = req.body || {};
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
 * @desc Predicts demand for a specific route and time using actual ML microservice.
 * @access Public (with strict rate limits) or Private
 */
router.post('/predict-demand', strictMlRateLimiter, validateMlRequest, async (req, res) => {
    try {
        const { origin, destination, date, cargoType } = req.body;
        const payload = { origin, destination, date, cargoType };

        let mlResponseData = null;

        try {
            const mlBaseUrl = getMlBaseUrl();
            const response = await axios.post(
                `${mlBaseUrl}/predict_demand`,
                payload,
                {
                    headers: getMlHeaders(),
                    timeout: getMlTimeoutMs()
                }
            );
            mlResponseData = response.data;
        } catch (mlErr) {
            // If primary /predict_demand endpoint is 404, attempt fallback to /predict/demand
            if (mlErr.response?.status === 404) {
                const mlBaseUrl = getMlBaseUrl();
                const fallbackResponse = await axios.post(
                    `${mlBaseUrl}/predict/demand`,
                    payload,
                    {
                        headers: getMlHeaders(),
                        timeout: getMlTimeoutMs()
                    }
                );
                mlResponseData = fallbackResponse.data;
            } else {
                throw mlErr;
            }
        }

        const demandScore = typeof mlResponseData?.demandScore === 'number'
            ? mlResponseData.demandScore
            : (typeof mlResponseData?.demand_score === 'number'
                ? mlResponseData.demand_score
                : (typeof mlResponseData?.predicted_demand === 'number' ? mlResponseData.predicted_demand : 0.85));

        const estimatedPrice = typeof mlResponseData?.estimatedPrice === 'number'
            ? mlResponseData.estimatedPrice
            : (typeof mlResponseData?.estimated_price === 'number'
                ? mlResponseData.estimated_price
                : 15000);

        const confidence = typeof mlResponseData?.confidence === 'number'
            ? mlResponseData.confidence
            : (typeof mlResponseData?.confidence_score === 'number'
                ? mlResponseData.confidence_score
                : 0.92);

        const mlResponse = {
            ...mlResponseData,
            demandScore,
            estimatedPrice,
            confidence
        };

        // Apply obfuscation to the estimated price
        const userId = req.user?.id || null;
        const finalEstimatedPrice = await applyPriceObfuscation(mlResponse.estimatedPrice, userId);

        res.json({
            success: true,
            data: {
                ...mlResponse,
                estimatedPrice: finalEstimatedPrice
            }
        });
    } catch (err) {
        // Fallback for non-production environments if the ML microservice is unavailable
        if (process.env.NODE_ENV !== 'production') {
            logger.warn({ err: err?.message, body: req.body }, '[MLPricing] ML service unreachable in development, falling back to mock');
            const mockMlResponse = {
                demandScore: 0.85,
                estimatedPrice: 15000,
                confidence: 0.92
            };
            const userId = req.user?.id || null;
            const finalEstimatedPrice = await applyPriceObfuscation(mockMlResponse.estimatedPrice, userId);
            return res.json({
                success: true,
                data: {
                    ...mockMlResponse,
                    estimatedPrice: finalEstimatedPrice
                }
            });
        }

        logger.error({ err, body: req.body }, '[MLPricing] Error in predict-demand endpoint');
        res.status(500).json({ error: 'Internal server error while predicting demand.' });
    }
});

/**
 * @route POST /api/v1/ml/search
 * @desc Searches for available loads/trucks with ML-optimized pricing using actual ML microservice.
 * @access Public (with strict rate limits) or Private
 */
router.post('/search', strictMlRateLimiter, validateMlRequest, async (req, res) => {
    try {
        const { origin, destination, vehicleType, maxPrice } = req.body;
        const payload = { origin, destination, vehicleType, maxPrice };

        let mlResponseData = null;

        try {
            const mlBaseUrl = getMlBaseUrl();
            const response = await axios.post(
                `${mlBaseUrl}/search_loads`,
                payload,
                {
                    headers: getMlHeaders(),
                    timeout: getMlTimeoutMs()
                }
            );
            mlResponseData = response.data;
        } catch (mlErr) {
            // If primary /search_loads endpoint is 404, attempt fallback to /search
            if (mlErr.response?.status === 404) {
                const mlBaseUrl = getMlBaseUrl();
                const fallbackResponse = await axios.post(
                    `${mlBaseUrl}/search`,
                    payload,
                    {
                        headers: getMlHeaders(),
                        timeout: getMlTimeoutMs()
                    }
                );
                mlResponseData = fallbackResponse.data;
            } else {
                throw mlErr;
            }
        }

        const rawResults = Array.isArray(mlResponseData?.results)
            ? mlResponseData.results
            : (Array.isArray(mlResponseData?.loads) ? mlResponseData.loads : (Array.isArray(mlResponseData) ? mlResponseData : []));

        // Apply obfuscation to each result's price
        const userId = req.user?.id || null;
        const obfuscatedResults = await Promise.all(
            rawResults.map(async (item) => {
                const itemPrice = typeof item.price === 'number'
                    ? item.price
                    : (typeof item.estimated_price === 'number' ? item.estimated_price : (item.freight_amount || 0));
                const obfuscatedPrice = await applyPriceObfuscation(itemPrice, userId);
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
        // Fallback for non-production environments if the ML microservice is unavailable
        if (process.env.NODE_ENV !== 'production') {
            logger.warn({ err: err?.message, body: req.body }, '[MLPricing] ML service unreachable in development, falling back to mock');
            const mockMlResponse = {
                results: [
                    { id: 'load-1', price: 12000, distance: 450 },
                    { id: 'load-2', price: 13500, distance: 460 }
                ]
            };
            const userId = req.user?.id || null;
            const obfuscatedResults = await Promise.all(
                mockMlResponse.results.map(async (item) => {
                    const obfuscatedPrice = await applyPriceObfuscation(item.price, userId);
                    return { ...item, price: obfuscatedPrice };
                })
            );
            return res.json({
                success: true,
                data: {
                    results: obfuscatedResults
                }
            });
        }

        logger.error({ err, body: req.body }, '[MLPricing] Error in search endpoint');
        res.status(500).json({ error: 'Internal server error while searching.' });
    }
});

export default router;
