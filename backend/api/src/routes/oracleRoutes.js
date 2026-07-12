import express from 'express';
import OracleService from '../services/oracle/OracleService.js';

const router = express.Router();
const oracleService = new OracleService();

// Get oracle status
router.get('/status', async (req, res) => {
  try {
    res.status(200).json({
      success: true,
      data: {
        providers: oracleService.providers.length,
        threshold: oracleService.consensusThreshold,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Confirm delivery via oracle
router.post('/confirm', async (req, res) => {
  try {
    const { orderId, otp, gpsCoordinates } = req.body;
    const result = await oracleService.confirmDelivery({
      orderId,
      otp,
      gpsCoordinates
    });
    
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

// Cross-chain verification
router.post('/verify-crosschain', async (req, res) => {
  try {
    const { orderId, blockchainHash } = req.body;
    const result = await oracleService.verifyCrossChain(orderId, blockchainHash);
    
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