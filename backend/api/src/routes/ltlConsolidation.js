import express from 'express';
import { matchLtlPartialLoads, optimizeLtlConsolidationKnapsack } from '../services/ltlConsolidation.js';

const router = express.Router();

/**
 * Evaluates candidate spot loads and returns ranked matches.
 * POST /api/ltl-consolidation/match
 */
router.post('/match', (req, res) => {
    try {
        const { truck, partialLoads } = req.body || {};

        if (!truck || typeof truck !== 'object' || !truck.id) {
            return res.status(400).json({
                success: false,
                error: 'Valid truck payload with remaining capacity parameters is required.'
            });
        }

        if (!partialLoads || !Array.isArray(partialLoads)) {
            return res.status(400).json({
                success: false,
                error: 'Array of candidate partial spot loads is required.'
            });
        }

        const matchResults = matchLtlPartialLoads(truck, partialLoads);

        return res.status(200).json({
            success: true,
            data: matchResults
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Runs 2D Knapsack branch-and-bound optimization to find maximum revenue multi-load consolidation
 * enforcing linear feet, gross weight, detour limits, and HAZMAT segregation.
 * POST /api/ltl-consolidation/optimize
 */
router.post('/optimize', (req, res) => {
    try {
        const { truck, partialLoads, options } = req.body || {};

        if (!truck || typeof truck !== 'object' || !truck.id) {
            return res.status(400).json({
                success: false,
                error: 'Valid truck payload with remaining capacity parameters is required.'
            });
        }

        if (!partialLoads || !Array.isArray(partialLoads)) {
            return res.status(400).json({
                success: false,
                error: 'Array of candidate partial spot loads is required.'
            });
        }

        const optimalManifest = optimizeLtlConsolidationKnapsack(truck, partialLoads, options);

        return res.status(200).json({
            success: true,
            data: optimalManifest
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

export default router;
