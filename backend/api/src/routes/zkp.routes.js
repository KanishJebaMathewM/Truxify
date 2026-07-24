import express from 'express';
import rateLimit from 'express-rate-limit';
import zkpService from '../services/zkp/zkp.service.js';
import logger from '../middleware/logger.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { userLimiter, safeIpKeyGenerator, createStore } from '../middleware/rateLimiter.js';

const router = express.Router();
const PRIVILEGED_VERIFICATION_ROLES = new Set(['admin', 'regulator']);
const zkpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: safeIpKeyGenerator,
  store: createStore('rl:zkp-verify:'),
  message: { error: 'Rate limit exceeded', retryAfter: 900 },
});

function canVerifyUser(requestUser, targetUserId) {
  return requestUser?.id === targetUserId || PRIVILEGED_VERIFICATION_ROLES.has(requestUser?.role);
}

// Verify driver KYC using ZK-SNARK
router.post('/zkp/verify', zkpVerifyLimiter, authenticate, async (req, res) => {
  try {
    const { userId, name, licenseNumber, rcNumber, insuranceNumber, issueDate, expiryDate } = req.body;
    
    if (!userId || !name || !licenseNumber) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: userId, name, licenseNumber'
      });
    }

    if (!canVerifyUser(req.user, userId)) {
      return res.status(403).json({
        success: false,
        error: 'Access denied: cannot verify another user.'
      });
    }
    
    const result = await zkpService.verifyDriver({
      userId,
      name,
      licenseNumber,
      rcNumber: rcNumber || '',
      insuranceNumber: insuranceNumber || '',
      issueDate: issueDate || new Date().toISOString(),
      expiryDate: expiryDate || new Date(Date.now() + 5 * 365 * 24 * 60 * 60 * 1000).toISOString()
    });
    
    if (result.success) {
      res.json({
        success: true,
        data: result,
        message: 'KYC verification successful',
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error,
        message: 'KYC verification failed'
      });
    }
  } catch (error) {
    logger.error('ZK verification route error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Check verification status
router.get('/zkp/status/:userId', authenticate, userLimiter, async (req, res) => {
  try {
    const { userId } = req.params;
    const verified = await zkpService.isVerified(userId);
    
    res.json({
      success: true,
      data: {
        userId,
        verified,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Status check error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get document hash (regulator only)
router.get('/zkp/document-hash/:userId', authenticate, userLimiter, requireRole(['REGULATOR']), async (req, res) => {
  try {
    const { userId } = req.params;
    const hash = await zkpService.getDocumentHash(userId);
    
    res.json({
      success: true,
      data: {
        userId,
        documentHash: hash,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Document hash fetch error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get verification stats
router.get('/zkp/stats', authenticate, userLimiter, requireRole(['REGULATOR']), async (req, res) => {
  try {
    const stats = await zkpService.getVerificationStats();
    
    res.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Stats fetch error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
