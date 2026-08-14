import fraudDetection from '../services/fraud/FraudDetectionService.js';
import logger from './logger.js';

const RISK_REVIEW_THRESHOLD = 0.7;
const RISK_BLOCK_THRESHOLD = 0.9;

export const fraudDetectionMiddleware = async (req, res, next) => {
  try {
    const userId = req.user?.id;

    const criticalEndpoints = [
      '/api/orders',
      '/api/payments',
      '/api/escrow',
      '/api/trips'
    ];

    const isCritical = criticalEndpoints.some(endpoint => req.originalUrl.startsWith(endpoint));

    if (!userId) {
      // Authentication has not run yet or this is a public endpoint.
      // Never block — just skip fraud checks and let authenticate() handle authz.
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
    if (isCritical) {
      const risk = await fraudDetection.getRealTimeRisk(userId, {
        amount: req.body?.amount || 0,
        frequency: 1,
        deviceChanged: req.deviceChanged || false
      });

      if (risk && risk.riskScore > RISK_REVIEW_THRESHOLD) {
        // Flag for review
        await fraudDetection.addToReviewQueue(
          userId,
          `Suspicious activity on ${req.path}`,
          risk.riskScore
        );

        // Block high-risk transactions
        if (risk.riskScore > RISK_BLOCK_THRESHOLD) {
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
    logger.error({ err: error }, 'Fraud middleware error — failing closed');
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
    logger.error({ err: error }, 'Network analysis middleware error — failing closed');
    return res.status(503).json({
      error: 'Fraud detection service is temporarily unavailable. Please retry.',
    });
  }
};


// === Spec 13: ===
// === Spec 13: clamp fraud risk score [0, 100] ===
export function clampRiskScore(v) {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 100) return 100;
  return v;
}
export function accumulateRisk(weights) {
  if (!Array.isArray(weights)) return 0;
  return clampRiskScore(weights.reduce((a, w) => a + (Number.isFinite(w) ? w : 0), 0));
}

