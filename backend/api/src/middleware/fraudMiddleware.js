import fraudDetection from '../services/fraud/FraudDetectionService.js';
import logger from './logger.js';

export const fraudDetectionMiddleware = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      logger.warn('[Fraud] Skipping fraud check — no userId on request');
      return next();
    }

    // Track user behavior
    const behaviorData = {
      type: req.method,
      endpoint: req.path,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      timestamp: Date.now()
    };

    await fraudDetection.trackBehavior(userId, behaviorData);

    // Get real-time risk for critical endpoints
    const criticalEndpoints = [
      '/api/orders',
      '/api/payments',
      '/api/escrow',
      '/api/trips'
    ];

    if (criticalEndpoints.some(endpoint => req.path.startsWith(endpoint))) {
      const risk = await fraudDetection.getRealTimeRisk(userId, {
        amount: req.body?.amount || 0,
        frequency: 1,
        deviceChanged: req.deviceChanged || false
      });

      if (risk && risk.riskScore > 0.7) {
        // Flag for review
        await fraudDetection.addToReviewQueue(
          userId,
          `Suspicious activity on ${req.path}`,
          risk.riskScore
        );

        // Block high-risk transactions
        if (risk.riskScore > 0.9) {
          return res.status(403).json({
            error: 'Transaction blocked due to suspicious activity',
            riskScore: risk.riskScore,
            riskLevel: risk.riskLevel
          });
        }
      }

      // Add risk info to request for downstream use
      req.riskScore = risk?.riskScore || 0;
      req.riskLevel = risk?.riskLevel || 'LOW';
    }

    next();
  } catch (error) {
    logger.error('Fraud middleware error — failing closed:', error);
    return res.status(503).json({
      error: 'Fraud detection service is temporarily unavailable. Please retry.',
    });
  }
};

export const networkAnalysisMiddleware = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      logger.warn('[Fraud] Skipping network analysis — no userId on request');
      return next();
    }

    const networkRisk = await fraudDetection.analyzeNetwork(userId);
    if (networkRisk && networkRisk.isInFraudRing) {
      await fraudDetection.addToReviewQueue(
        userId,
        'Part of suspected fraud ring',
        networkRisk.networkRisk
      );
    }

    req.networkRisk = networkRisk;
    next();
  } catch (error) {
    logger.error('Network analysis middleware error — failing closed:', error);
    return res.status(503).json({
      error: 'Fraud detection service is temporarily unavailable. Please retry.',
    });
  }
};
