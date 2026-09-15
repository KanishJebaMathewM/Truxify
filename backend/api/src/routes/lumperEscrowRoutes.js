import express from 'express';
import { lumperEscrowService } from '../services/lumperEscrowService.js';
import { supabase, supabaseAdmin } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// Resolves the authenticated user's on-chain wallet from their profile.
// Ownership is checked against this resolved wallet, never against req.user.id
// (a UUID) or an arbitrary wallet supplied in the request body.
async function resolveProfileWallet(req) {
  if (!req.user?.id) return null;
  const db = supabaseAdmin || supabase;
  if (!db) return null;
  try {
    const { data, error } = await db
      .from('profiles')
      .select('polygon_wallet_address')
      .eq('id', req.user.id)
      .maybeSingle();
    if (error || !data) return null;
    return data.polygon_wallet_address ? data.polygon_wallet_address.trim() : null;
  } catch (err) {
    return null;
  }
}

/**
 * POST /api/lumper-escrow/deposit
 * Broker pre-deposits estimated lumper fee into smart contract escrow
 */
router.post('/deposit', authenticate, userLimiter, async (req, res) => {
  try {
    if (req.user.role !== 'broker' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only brokers or admins can deposit lumper fees.' });
    }

    let { booking_id, broker_address, estimated_fee } = req.body;

    if (!booking_id || !broker_address || !estimated_fee) {
      return res.status(400).json({ error: 'Missing required parameters: booking_id, broker_address, estimated_fee' });
    }

    if (req.user.role !== 'admin') {
      const callerWallet = await resolveProfileWallet(req);
      if (!callerWallet || callerWallet !== broker_address.trim()) {
        return res.status(403).json({ error: 'Access denied. Broker wallet must match the wallet on your profile.' });
      }
      broker_address = callerWallet;
    } else {
      broker_address = broker_address.trim();
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
    if (req.user.role !== 'driver' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only drivers or admins can release lumper escrow.' });
    }

    let { escrow_id, driver_wallet, receipt_url, claimed_amount } = req.body;

    if (!escrow_id || !driver_wallet || !receipt_url) {
      return res.status(400).json({ error: 'Missing required parameters: escrow_id, driver_wallet, receipt_url' });
    }

    if (req.user.role !== 'admin') {
      const callerWallet = await resolveProfileWallet(req);
      if (!callerWallet || callerWallet !== driver_wallet.trim()) {
        return res.status(403).json({ error: 'Access denied. Driver wallet must match the wallet on your profile.' });
      }
      driver_wallet = callerWallet;
    } else {
      driver_wallet = driver_wallet.trim();
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

    if (req.user.role !== 'admin') {
      const callerWallet = await resolveProfileWallet(req);
      const isBroker = callerWallet && escrow.brokerAddress === callerWallet;
      const isDriver = callerWallet && escrow.driverWallet === callerWallet;
      if (!isBroker && !isDriver) {
        return res.status(403).json({ error: 'Access denied. You are not a participant in this escrow.' });
      }
    }

    return res.json({ escrow });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve lumper escrow status' });
  }
});

export default router;
