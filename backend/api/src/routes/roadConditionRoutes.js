import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { reportGripData, getNearbyGripData } from '../controllers/roadConditionController.js';
import rateLimit from 'express-rate-limit';
import { safeIpKeyGenerator, createStore } from '../middleware/rateLimiter.js';

const router = express.Router();

const roadConditionLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 100, // allow more frequent telemetry updates
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: safeIpKeyGenerator,
  store: createStore('rl:road-conditions:'),
});

// POST /api/road-conditions/grip
// Report micro-slips and grip index
router.post('/grip', roadConditionLimiter, authenticate, reportGripData);

// GET /api/road-conditions/grip/nearby
// Retrieve nearby grip data
router.get('/grip/nearby', roadConditionLimiter, authenticate, getNearbyGripData);

export default router;
