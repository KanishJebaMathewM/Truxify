import express from 'express';
import {
  getTireWearPrediction,
  evaluateTripDegradation,
} from '../controllers/tireWearController.js';

const router = express.Router();

/**
 * GET /api/tire-wear/:driverId/prediction
 * Retrieves aggregate tire prognostics and lifespan projections for a driver.
 */
router.get('/:driverId/prediction', getTireWearPrediction);

/**
 * POST /api/tire-wear/evaluate-trip
 * Evaluates instantaneous tire degradation across axle load curves.
 */
router.post('/evaluate-trip', evaluateTripDegradation);

export default router;
