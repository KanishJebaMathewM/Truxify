import express from 'express';
import { getTireWearPrediction } from '../controllers/tireWearController.js';
import { authenticate } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

router.get('/:driverId/prediction', authenticate, userLimiter, (req, res, next) => {
  if (req.user.role !== 'admin' && req.user.id !== req.params.driverId) {
    return res.status(403).json({ error: 'Access denied. You can only view your own tire wear predictions.' });
  }
  return getTireWearPrediction(req, res, next);
});

export default router;
