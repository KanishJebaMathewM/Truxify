import { calculateTireWear, calculateTripTireDegradation } from '../services/tireWearService.js';
import logger from '../middleware/logger.js';

/**
 * Retrieves aggregate tire wear prognostics and remaining life estimates for a driver.
 */
export const getTireWearPrediction = async (req, res) => {
  try {
    const { driverId } = req.params;

    if (!driverId || typeof driverId !== 'string' || driverId.trim() === '') {
      return res.status(400).json({ success: false, error: 'driverId parameter is required' });
    }

    // Role-based IDOR check: drivers can only inspect their own metrics unless caller is admin/carrier
    const requester = req.user;
    if (requester && requester.role === 'driver' && requester.id !== driverId && requester.uid !== driverId) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: You cannot inspect tire analytics for other drivers',
      });
    }

    const prediction = await calculateTireWear(driverId);
    return res.status(200).json({ success: true, data: prediction });
  } catch (err) {
    logger.error({ err: err.message, driverId: req.params?.driverId }, 'Tire wear prediction failed');
    return res.status(500).json({ success: false, error: 'Failed to calculate tire wear analytics' });
  }
};

/**
 * Evaluates instantaneous trip degradation given dynamic route parameters.
 */
export const evaluateTripDegradation = async (req, res) => {
  try {
    const { distanceKm, loadWeightKg, roadCondition, weather, axleType, currentTreadDepthMm } = req.body;

    if (typeof distanceKm !== 'number' || distanceKm < 0) {
      return res.status(400).json({ success: false, error: 'distanceKm must be a non-negative number' });
    }

    const metrics = calculateTripTireDegradation({
      distanceKm,
      loadWeightKg: Number(loadWeightKg) || 0,
      roadCondition: roadCondition || 'good',
      weather: weather || 'clear',
      axleType: axleType || 'drive',
      currentTreadDepthMm: Number(currentTreadDepthMm) || 16.0,
    });

    return res.status(200).json({ success: true, data: metrics });
  } catch (err) {
    logger.error({ err: err.message }, 'Trip degradation evaluation failed');
    return res.status(500).json({ success: false, error: err.message });
  }
};

export default {
  getTireWearPrediction,
  evaluateTripDegradation,
};
