import express from 'express';
import VerificationService from '../services/verification/VerificationService.js';

const router = express.Router();
const verificationService = new VerificationService();

// Verification endpoint for orders
router.get('/order/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const result = await verificationService.verifyOrder(orderId);
    
    res.status(200).json({
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

// Document integrity check
router.post('/documents/check', async (req, res) => {
  try {
    const { driverId } = req.body;
    const result = await verificationService.checkDocumentIntegrity(driverId);
    
    res.status(200).json({
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