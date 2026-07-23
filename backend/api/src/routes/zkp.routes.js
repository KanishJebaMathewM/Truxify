import express from 'express';
import zkpService from '../services/zkp/zkp.service.js';
import logger from '../middleware/logger.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// Verify driver KYC using ZK-SNARK
router.post('/zkp/verify', authenticate, userLimiter, async (req, res) => {
  try {
    const { userId, name, licenseNumber, rcNumber, insuranceNumber, issueDate, expiryDate } = req.body;
    
    if (!userId || !name || !licenseNumber) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: userId, name, licenseNumber'
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