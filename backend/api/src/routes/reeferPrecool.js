import express from 'express';
import {
    evaluateReeferPrecooling,
    simulateThermodynamicPulldown,
    evaluatePrecoolWithThermodynamics,
    COMMODITY_PRESETS
} from '../services/reeferPrecool.js';

const router = express.Router();

/**
 * Standard pre-cooling evaluation endpoint.
 * POST /api/reefer-precool/evaluate-precool
 */
router.post('/evaluate-precool', (req, res) => {
    try {
        const { reeferId, etaMinutes, targetCargoTempF, currentReeferTempF, ambientWeatherTempF } = req.body || {};

        if (!reeferId) {
            return res.status(400).json({
                success: false,
                error: 'reeferId parameter is required.'
            });
        }

        const evaluation = evaluateReeferPrecooling({
            reeferId,
            etaMinutes,
            targetCargoTempF,
            currentReeferTempF,
            ambientWeatherTempF
        });

        return res.status(200).json({
            success: true,
            data: evaluation
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Thermodynamic physics simulation of trailer temperature pulldown curve.
 * POST /api/reefer-precool/simulate-pulldown
 */
router.post('/simulate-pulldown', (req, res) => {
    try {
        const { initialTempF, targetTempF, ambientTempF, insulationRating, reeferMode } = req.body || {};

        const simulation = simulateThermodynamicPulldown({
            initialTempF,
            targetTempF,
            ambientTempF,
            insulationRating,
            reeferMode
        });

        return res.status(200).json({
            success: true,
            data: simulation
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Commodity-aware precooling evaluation with cold-chain compliance guarantees.
 * POST /api/reefer-precool/evaluate-thermodynamic
 */
router.post('/evaluate-thermodynamic', (req, res) => {
    try {
        const { reeferId, commodityKey, customTargetTempF, currentReeferTempF, ambientWeatherTempF, etaMinutes } = req.body || {};

        if (!reeferId) {
            return res.status(400).json({
                success: false,
                error: 'reeferId parameter is required.'
            });
        }

        const plan = evaluatePrecoolWithThermodynamics({
            reeferId,
            commodityKey,
            customTargetTempF,
            currentReeferTempF,
            ambientWeatherTempF,
            etaMinutes
        });

        return res.status(200).json({
            success: true,
            data: plan
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Lists verified cold-chain commodity temperature profiles and freezing hazard boundaries.
 * GET /api/reefer-precool/commodity-presets
 */
router.get('/commodity-presets', (req, res) => {
    return res.status(200).json({
        success: true,
        data: COMMODITY_PRESETS
    });
});

export default router;
