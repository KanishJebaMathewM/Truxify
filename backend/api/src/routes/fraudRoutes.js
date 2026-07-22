import express from 'express';
import fraudDetection from '../services/fraud/FraudDetectionService.js';
import { fraudDetectionMiddleware } from '../middleware/fraudMiddleware.js';
import { authenticate } from '../middleware/auth.js';
import { requirePolicy } from '../middleware/requirePolicy.js';
import { userLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// Get fraud stats
router.get('/fraud/stats', authenticate, userLimiter, requirePolicy('fraud:view-stats'), async (req, res) => {
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
router.get('/fraud/risk/:userId', authenticate, userLimiter, requirePolicy('fraud:view-risk'), async (req, res) => {
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
router.get('/fraud/review-queue', authenticate, userLimiter, requirePolicy('fraud:manage-review'), async (req, res) => {
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
router.post('/fraud/review/:reviewId/resolve', authenticate, userLimiter, requirePolicy('fraud:manage-review'), async (req, res) => {
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
router.post('/fraud/track', authenticate, userLimiter, requirePolicy('fraud:track'), fraudDetectionMiddleware, async (req, res) => {
  try {
    const { userId: bodyUserId, eventType, data } = req.body;
    const userId = req.user.id;

    if (bodyUserId && bodyUserId !== userId) {
      return res.status(400).json({
        success: false,
        error: 'userId must match the authenticated user'
      });
    }

    const result = await fraudDetection.trackBehavior(userId, {
      type: eventType,
      ...(data && typeof data === 'object' && !Array.isArray(data) ? data : {})
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
router.post('/fraud/analyze-network/:userId', authenticate, userLimiter, requirePolicy('fraud:analyze-network'), async (req, res) => {
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
