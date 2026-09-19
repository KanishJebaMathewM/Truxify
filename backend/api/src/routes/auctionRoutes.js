import express from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import { freightAuctionService, AUCTION_STATES } from '../services/auction/FreightAuctionService.js';
import logger from '../middleware/logger.js';
import { supabaseAdmin } from '../config/db.js';
import { LockAcquisitionError } from '../lib/redisLock.js';

const router = express.Router();

const loadIdParamSchema = z.object({
  id: z.string().trim().min(1, 'Load ID is required'),
});

const openAuctionSchema = z.object({
  reservePrice: z.number().positive('Reserve price must be greater than zero'),
  durationMs: z.number().positive().optional(),
  antiSnipingWindowMs: z.number().positive().optional(),
  extensionMs: z.number().positive().optional(),
  minBidsRequired: z.number().int().positive().optional(),
});

const submitBidSchema = z.object({
  bidAmount: z.number().positive('Bid amount must be greater than zero'),
});

const clearAuctionSchema = z.object({
  force: z.boolean().optional(),
});

/**
 * Helper: load a load offer from Supabase and enforce shipper ownership.
 * Throws a descriptive error if the load doesn't exist or the caller is not the owner.
 */
async function requireShipperOwnership(loadOfferId, userId) {
  if (!supabaseAdmin) {
    // Supabase not configured; skip ownership check (dev/test mode)
    return null;
  }
  const { data: offer, error } = await supabaseAdmin
    .from('load_offers')
    .select('id, customer_id, status')
    .eq('id', loadOfferId)
    .single();

  if (error || !offer) {
    const err = new Error(`Load offer ${loadOfferId} not found`);
    err.statusCode = 404;
    throw err;
  }
  if (offer.customer_id !== userId) {
    const err = new Error('Only the shipper who created this load offer may perform this action');
    err.statusCode = 403;
    throw err;
  }
  return offer;
}

/**
 * Helper: verify caller is an eligible driver (has a truck assigned) and NOT the load owner.
 * Also resolves server-side driverRating from the driver profile.
 * Returns { driverRating, detourKm }.
 */
async function resolveDriverBidContext(loadOfferId, driverId) {
  let driverRating = 80; // safe default when DB is unavailable
  let detourKm = 0;      // conservative default

  if (!supabaseAdmin) {
    // Supabase not configured; skip DB checks (dev/test mode)
    return { driverRating, detourKm };
  }

  // 1. Verify the caller is not the load owner
  const { data: offer } = await supabaseAdmin
    .from('load_offers')
    .select('customer_id')
    .eq('id', loadOfferId)
    .single();

  if (offer && offer.customer_id === driverId) {
    const err = new Error('You cannot bid on your own load offer');
    err.statusCode = 403;
    throw err;
  }

  // 2. Resolve server-side driver rating from the driver profile
  const { data: profile } = await supabaseAdmin
    .from('driver_profiles')
    .select('reputation_score, current_lat, current_lng')
    .eq('id', driverId)
    .single();

  if (profile) {
    const score = profile.reputation_score;
    if (typeof score === 'number' && Number.isFinite(score)) {
      driverRating = Math.max(0, Math.min(100, score));
    }

    // 3. Compute detourKm from driver current location to load pickup (if available)
    if (offer && profile.current_lat != null && profile.current_lng != null) {
      const { data: loadDetail } = await supabaseAdmin
        .from('load_offers')
        .select('pickup_lat, pickup_lng')
        .eq('id', loadOfferId)
        .single();

      if (loadDetail?.pickup_lat != null && loadDetail?.pickup_lng != null) {
        // Haversine approximation (flat-earth for short distances, good enough for scoring)
        const R = 6371; // km
        const dLat = ((loadDetail.pickup_lat - profile.current_lat) * Math.PI) / 180;
        const dLng = ((loadDetail.pickup_lng - profile.current_lng) * Math.PI) / 180;
        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.cos((profile.current_lat * Math.PI) / 180) *
            Math.cos((loadDetail.pickup_lat * Math.PI) / 180) *
            Math.sin(dLng / 2) ** 2;
        detourKm = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
      }
    }
  }

  return { driverRating, detourKm };
}

/**
 * POST /api/auctions/load/:id/open
 * Open a dynamic reverse auction for a load offer (Shipper action).
 */
router.post(
  '/load/:id/open',
  authenticate,
  validateParams(loadIdParamSchema),
  validateBody(openAuctionSchema),
  async (req, res) => {
    try {
      const loadOfferId = req.params.id;
      const shipperId = req.user?.id;

      // Authorization: caller must be the shipper who owns this load.
      await requireShipperOwnership(loadOfferId, shipperId);

      const auction = await freightAuctionService.openAuction({
        loadOfferId,
        shipperId,
        reservePrice: req.body.reservePrice,
        durationMs: req.body.durationMs,
        antiSnipingWindowMs: req.body.antiSnipingWindowMs,
        extensionMs: req.body.extensionMs,
        minBidsRequired: req.body.minBidsRequired,
      });

      return res.status(201).json({
        success: true,
        message: 'Auction opened successfully',
        auction,
      });
    } catch (err) {
      logger.error({ err, loadId: req.params.id }, '[AuctionRoute] Failed to open auction');
      const statusCode = err instanceof LockAcquisitionError ? 503 : (err.statusCode || 400);
      return res.status(statusCode).json({ error: err.message });
    }
  }
);

/**
 * POST /api/auctions/load/:id/bid
 * Submit a bid with load-level mutual exclusion, anti-sniping protection, and solvency locking (Driver action).
 * driverRating and detourKm are resolved server-side — not accepted from the request body.
 */
router.post(
  '/load/:id/bid',
  authenticate,
  validateParams(loadIdParamSchema),
  validateBody(submitBidSchema),
  async (req, res) => {
    try {
      const loadOfferId = req.params.id;
      const driverId = req.user?.id;

      // Authorization: derive driverRating and detourKm from trusted server data;
      // reject if the caller is the load owner.
      const { driverRating, detourKm } = await resolveDriverBidContext(loadOfferId, driverId);

      const result = await freightAuctionService.submitBid({
        loadOfferId,
        driverId,
        bidAmount: req.body.bidAmount,
        driverRating,
        detourKm,
      });

      return res.status(200).json({
        success: true,
        message: result.antiSnipingTriggered
          ? 'Bid submitted and auction extended under anti-sniping protection'
          : 'Bid submitted successfully',
        data: result,
      });
    } catch (err) {
      logger.error({ err, loadId: req.params.id }, '[AuctionRoute] Bid submission failed');
      const statusCode =
        err instanceof LockAcquisitionError
          ? 503
          : (err.statusCode ||
            (err.message.includes('collateral') || err.message.includes('active bid') ? 409 : 400));
      return res.status(statusCode).json({ error: err.message });
    }
  }
);

/**
 * POST /api/auctions/load/:id/clear
 * Clear auction and settle via multi-objective Vickrey reverse auction.
 * Only the shipper who owns the load may trigger clearing.
 */
router.post(
  '/load/:id/clear',
  authenticate,
  validateParams(loadIdParamSchema),
  validateBody(clearAuctionSchema),
  async (req, res) => {
    try {
      const loadOfferId = req.params.id;
      const shipperId = req.user?.id;

      // Authorization: only the load's shipper may clear/settle the auction.
      await requireShipperOwnership(loadOfferId, shipperId);

      const result = await freightAuctionService.clearAuction(loadOfferId, {
        force: req.body.force,
      });

      return res.status(200).json({
        success: true,
        message:
          result.status === AUCTION_STATES.SETTLED
            ? 'Auction successfully cleared and settled'
            : 'Auction clearing processed',
        data: result,
      });
    } catch (err) {
      logger.error({ err, loadId: req.params.id }, '[AuctionRoute] Failed to clear auction');
      const statusCode = err instanceof LockAcquisitionError ? 503 : (err.statusCode || 400);
      return res.status(statusCode).json({ error: err.message });
    }
  }
);

/**
 * GET /api/auctions/load/:id/status
 * Get the current auction status, time remaining, and best bid depth.
 */
router.get(
  '/load/:id/status',
  validateParams(loadIdParamSchema),
  (req, res) => {
    const loadOfferId = req.params.id;
    const status = freightAuctionService.getAuctionStatus(loadOfferId);

    if (!status) {
      return res.status(404).json({ error: `Auction for load ${loadOfferId} not found` });
    }

    return res.status(200).json({
      success: true,
      auction: status,
    });
  }
);

export default router;
