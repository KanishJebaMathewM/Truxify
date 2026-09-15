const express = require('express');
const router = express.Router();
const tireWearController = require('../controllers/tireWearController');
const { authenticate } = require('../middleware/auth');
const { userLimiter } = require('../middleware/rateLimiter');

router.get('/:driverId/prediction', authenticate, userLimiter, (req, res, next) => {
  if (req.user.role !== 'admin' && req.user.id !== req.params.driverId) {
    return res.status(403).json({ error: 'Access denied. You can only view your own tire wear predictions.' });
  }
  return tireWearController.getTireWearPrediction(req, res, next);
});

module.exports = router;
