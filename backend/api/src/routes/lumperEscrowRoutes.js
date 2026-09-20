import express from 'express';
import { lumperEscrowService } from '../services/lumperEscrowService.js';
import { authenticate } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const MAX_LUMPER_FEE_USD = 10000;

/**
 * Validates EVM wallet address format.
 */
export const isValidEvmAddress = (address) => {
  return typeof address === 'string' && EVM_ADDRESS_REGEX.test(address);
};

/**
 * Validates secure web URL.
 */
export const isValidReceiptUrl = (url) => {
  if (typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * POST /api/lumper-escrow/deposit
 * Broker pre-deposits estimated lumper fee into smart contract escrow
 */
router.post('/deposit', authenticate, userLimiter, async (req, res) => {
  try {
    // Role check: Only authorized brokers or admins may deposit into escrow
    if (req.user && req.user.role !== 'broker' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access Denied: Only brokers or admins can deposit lumper escrow funds' });
    }

    const { booking_id, broker_address, estimated_fee } = req.body;

    if (!booking_id || !broker_address || estimated_fee === undefined) {
      return res.status(400).json({ error: 'Missing required parameters: booking_id, broker_address, estimated_fee' });
    }

    if (!isValidEvmAddress(broker_address)) {
      return res.status(400).json({ error: 'Invalid broker_address: Must be a valid 40-character hex EVM address' });
    }

    const feeAmount = Number(estimated_fee);
    if (!Number.isFinite(feeAmount) || feeAmount <= 0) {
      return res.status(400).json({ error: 'estimated_fee must be a positive finite number' });
    }

    if (feeAmount > MAX_LUMPER_FEE_USD) {
      return res.status(400).json({ error: `estimated_fee exceeds maximum permissible limit of $${MAX_LUMPER_FEE_USD}` });
    }

    const escrow = await lumperEscrowService.depositLumperFee({
      bookingId: booking_id,
      brokerAddress: broker_address,
      estimatedFeeAmount: feeAmount
    });

    return res.status(201).json({
      message: 'Lumper fee successfully deposited into escrow contract',
      escrow
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to deposit lumper fee into escrow' });
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

    // Role check: Only drivers or admins can claim lumper fee releases
    if (req.user && req.user.role !== 'driver' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access Denied: Only assigned drivers or admins can release lumper fee' });
    }

    if (!isValidEvmAddress(driver_wallet)) {
      return res.status(400).json({ error: 'Invalid driver_wallet: Must be a valid 40-character hex EVM address' });
    }

    if (!isValidReceiptUrl(receipt_url)) {
      return res.status(400).json({ error: 'Invalid receipt_url: Must be a valid HTTP/HTTPS URL' });
    }

    let parsedClaimed = undefined;
    if (claimed_amount !== undefined && claimed_amount !== null) {
      parsedClaimed = Number(claimed_amount);
      if (!Number.isFinite(parsedClaimed) || parsedClaimed <= 0) {
        return res.status(400).json({ error: 'claimed_amount must be a positive finite number' });
      }
    }

    const releasedEscrow = await lumperEscrowService.processReceiptAndRelease({
      escrowId: escrow_id,
      driverWallet: driver_wallet,
      receiptImageUrl: receipt_url,
      claimedAmount: parsedClaimed
    });

    return res.json({
      message: 'Lumper fee receipt verified and funds released to driver',
      escrow: releasedEscrow
    });
  } catch (err) {
    const status = err.message?.includes('not found') ? 404 : 500;
    return res.status(status).json({ error: err.message || 'Failed to process lumper receipt release' });
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
