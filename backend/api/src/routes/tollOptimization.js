import express from 'express';
import { optimizeTollRoutes, calculateRouteOperatingCost } from '../services/tollOptimization.js';

const router = express.Router();

/**
 * Evaluates candidate routes and returns economic ranking (cheapest, fastest, greenest).
 * POST /api/tolls/optimize
 */
router.post('/optimize', (req, res) => {
    try {
        const { routes, loadDetails } = req.body || {};

        if (!routes || !Array.isArray(routes) || routes.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Array of candidate routes is required.'
            });
        }

        // Validate each route contains distanceMiles and estimatedTimeHours
        for (let i = 0; i < routes.length; i++) {
            const r = routes[i];
            if (!r || typeof r.distanceMiles !== 'number' || typeof r.estimatedTimeHours !== 'number') {
                return res.status(400).json({
                    success: false,
                    error: `Route at index ${i} is missing valid numeric distanceMiles or estimatedTimeHours`
                });
            }
        }

        const result = optimizeTollRoutes(routes, loadDetails);

        return res.status(200).json({
            success: true,
            data: result
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Calculates operational cost for a single route segment.
 * POST /api/tolls/operating-cost
 */
router.post('/operating-cost', (req, res) => {
    try {
        const { distanceMiles, estimatedTimeHours, tollCostUSD, fuelPrice, payloadWeightLbs, driverHourlyRate } = req.body || {};

        if (typeof distanceMiles !== 'number' || typeof estimatedTimeHours !== 'number') {
            return res.status(400).json({
                success: false,
                error: 'Numeric distanceMiles and estimatedTimeHours are required.'
            });
        }

        const cost = calculateRouteOperatingCost({
            distanceMiles,
            estimatedTimeHours,
            tollCostUSD,
            fuelPrice,
            payloadWeightLbs,
            driverHourlyRate
        });

        return res.status(200).json({
            success: true,
            data: cost
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

export default router;
