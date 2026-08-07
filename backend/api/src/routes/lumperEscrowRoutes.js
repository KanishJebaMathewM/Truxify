import express from 'express';
import { lumperEscrowService } from '../services/lumperEscrowService.js';
import { authenticate } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

/**
 * POST /api/lumper-escrow/deposit
 * Broker pre-deposits estimated lumper fee into smart contract escrow
 */
router.post('/deposit', authenticate, userLimiter, async (req, res) => {
  try {
    const { booking_id, broker_address, estimated_fee } = req.body;

    if (!booking_id || !broker_address || !estimated_fee) {
      return res.status(400).json({ error: 'Missing required parameters: booking_id, broker_address, estimated_fee' });
    }

    const escrow = await lumperEscrowService.depositLumperFee({
      bookingId: booking_id,
      brokerAddress: broker_address,
      estimatedFeeAmount: Number(estimated_fee)
    });

    return res.status(201).json({
      message: 'Lumper fee successfully deposited into escrow contract',
      escrow
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to deposit lumper fee into escrow' });
  }
});

/**
 * POST /api/lumper-escrow/release
 * Driver uploads lumper receipt; AI parses receipt and releases funds from smart contract
 */
router.post('/release', authenticate, userLimiter, async (req, res) => {
  try {
    const { escrow_id, driver_wallet, receipt_url, claimed_amount } = req.body;

    if (!escrow_id || !driver_wallet || !receipt_url) {
      return res.status(400).json({ error: 'Missing required parameters: escrow_id, driver_wallet, receipt_url' });
    }

    const releasedEscrow = await lumperEscrowService.processReceiptAndRelease({
      escrowId: escrow_id,
      driverWallet: driver_wallet,
      receiptImageUrl: receipt_url,
      claimedAmount: claimed_amount ? Number(claimed_amount) : undefined
    });

    return res.json({
      message: 'Lumper fee receipt verified and funds released to driver',
      escrow: releasedEscrow
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to process lumper receipt release' });
  }
});

/**
 * GET /api/lumper-escrow/:escrowId
 * Get lumper fee escrow status
 */
router.get('/:escrowId', authenticate, userLimiter, async (req, res) => {
  try {
    const { escrowId } = req.params;
    const escrow = await lumperEscrowService.getEscrowStatus(escrowId);

    if (!escrow) {
      return res.status(404).json({ error: 'Lumper escrow contract not found' });
    }

    return res.json({ escrow });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve lumper escrow status' });
  }
});

export default router;
