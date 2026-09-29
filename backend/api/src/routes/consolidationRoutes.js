import express from 'express';
import {
  calculateAxleWeightDistribution,
  pack3dLifoCargo,
  calculateConsolidationYield,
  defaultAxleWeightService,
} from '../services/ltlConsolidation.js';

const router = express.Router();

/**
 * POST /api/consolidation/axle-statics
 * Calculates beam-moment static load distribution and CMVR statutory axle limits.
 */
router.post('/axle-statics', (req, res) => {
  try {
    const { truckSpec, placedCargo } = req.body;

    if (!Array.isArray(placedCargo)) {
      return res.status(400).json({
        success: false,
        error: 'placedCargo must be an array of cargo items with weightKg and longitudinal positions.',
      });
    }

    const staticsResult = calculateAxleWeightDistribution(truckSpec || {}, placedCargo);

    return res.json({
      success: true,
      data: staticsResult,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/consolidation/pack-3d-lifo
 * Solves 3D combinatorial bin packing with orientation rules and topological LIFO delivery ordering.
 */
router.post('/pack-3d-lifo', (req, res) => {
  try {
    const { trailerSpec, cargoItems } = req.body;

    if (!Array.isArray(cargoItems)) {
      return res.status(400).json({
        success: false,
        error: 'cargoItems must be an array of items with dimensions and dropStopSequence.',
      });
    }

    const packingResult = pack3dLifoCargo(trailerSpec || {}, cargoItems);

    return res.json({
      success: true,
      data: packingResult,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/consolidation/consolidation-yield
 * Evaluates non-linear diesel consumption penalties against spot freight revenue.
 */
router.post('/consolidation-yield', (req, res) => {
  try {
    const yieldResult = calculateConsolidationYield(req.body || {});

    return res.json({
      success: true,
      data: yieldResult,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/consolidation/optimize
 * Full-stack optimization: 3D LIFO packing + CMVR axle statics + diesel economics.
 */
router.post('/optimize', (req, res) => {
  try {
    const { truck, candidateLoads, options } = req.body;

    if (!truck || !truck.id) {
      return res.status(400).json({
        success: false,
        error: 'Valid truck object with id and specification is required.',
      });
    }

    if (!Array.isArray(candidateLoads)) {
      return res.status(400).json({
        success: false,
        error: 'candidateLoads must be an array.',
      });
    }

    const optimizationPlan = defaultAxleWeightService.optimizeConsolidation(
      truck,
      candidateLoads,
      options || {}
    );

    return res.json({
      success: true,
      data: optimizationPlan,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
