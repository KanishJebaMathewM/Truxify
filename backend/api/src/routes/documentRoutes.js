import express from 'express';
import { verifyAndStoreDocument } from '../services/digilockerService.js';
import logger from '../middleware/logger.js';

const router = express.Router();

router.post('/verify-digilocker', async (req, res) => {
  const { code, docType, driverWalletAddress } = req.body;
  const driverId = req.user?.id || req.body.driverId;

  if (!code || !docType) {
    return res.status(400).json({
      error: 'Missing required fields: code and docType are required.',
    });
  }

  try {
    const result = await verifyAndStoreDocument({
      driverId,
      code,
      docType,
      driverWalletAddress,
    });

    return res.status(200).json({
      message: 'Document successfully verified via DigiLocker and registered on-chain.',
      data: result,
    });
  } catch (err) {
    logger.error({ err, driverId, docType }, '[Route] DigiLocker verification failed');
    return res.status(500).json({
      error: 'DigiLocker document verification failed.',
      details: err.message,
    });
  }
});

export default router;
