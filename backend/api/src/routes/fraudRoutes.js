import express from 'express';
import fraudDetection from '../services/fraud/FraudDetectionService.js';
import { fraudDetectionMiddleware } from '../middleware/fraudMiddleware.js';

const router = express.Router();

// Get fraud stats
router.get('/fraud/stats', async (req, res) => {
  try {
    const stats = await fraudDetection.getFraudStats();
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get user risk score
router.get('/fraud/risk/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const profile = await fraudDetection.getOrCreateProfile(userId);
    const riskScore = await fraudDetection.calculateBehavioralRisk(profile);
    const networkRisk = await fraudDetection.analyzeNetwork(userId);
    
    res.json({
      success: true,
      data: {
        userId,
        behavioralRisk: riskScore,
        networkRisk: networkRisk?.networkRisk || 0,
        isInFraudRing: networkRisk?.isInFraudRing || false
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get review queue
router.get('/fraud/review-queue', async (req, res) => {
  try {
    const queue = await fraudDetection.getReviewQueue(50);
    res.json({
      success: true,
      data: queue,
      count: queue.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Resolve review
router.post('/fraud/review/:reviewId/resolve', async (req, res) => {
  try {
    const { reviewId } = req.params;
    const { action, notes } = req.body;
    
    const result = await fraudDetection.resolveReview(reviewId, action, notes);
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Track behavior (for client reporting)
router.post('/fraud/track', fraudDetectionMiddleware, async (req, res) => {
  try {
    const { userId, eventType, data } = req.body;
    const result = await fraudDetection.trackBehavior(userId, {
      type: eventType,
      ...data
    });
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Analyze network (for manual trigger)
router.post('/fraud/analyze-network/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await fraudDetection.analyzeNetwork(userId);
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;