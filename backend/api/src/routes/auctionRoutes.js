import express from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import { freightAuctionService, AUCTION_STATES } from '../services/auction/FreightAuctionService.js';
import logger from '../middleware/logger.js';

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
  driverRating: z.number().min(0).max(100).optional(),
  detourKm: z.number().min(0).optional(),
});

const clearAuctionSchema = z.object({
  force: z.boolean().optional(),
});

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
      return res.status(400).json({ error: err.message });
    }
  }
);

/**
 * POST /api/auctions/load/:id/bid
 * Submit a bid with load-level mutual exclusion, anti-sniping protection, and solvency locking (Driver action).
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

      const result = await freightAuctionService.submitBid({
        loadOfferId,
        driverId,
        bidAmount: req.body.bidAmount,
        driverRating: req.body.driverRating,
        detourKm: req.body.detourKm,
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
      const statusCode = err.message.includes('collateral') || err.message.includes('active bid')
        ? 409
        : 400;
      return res.status(statusCode).json({ error: err.message });
    }
  }
);

/**
 * POST /api/auctions/load/:id/clear
 * Clear auction and settle via multi-objective Vickrey reverse auction.
 */
router.post(
  '/load/:id/clear',
  authenticate,
  validateParams(loadIdParamSchema),
  validateBody(clearAuctionSchema),
  async (req, res) => {
    try {
      const loadOfferId = req.params.id;
      const result = await freightAuctionService.clearAuction(loadOfferId, {
        force: req.body.force,
      });

      return res.status(200).json({
        success: true,
        message: result.status === AUCTION_STATES.SETTLED
          ? 'Auction successfully cleared and settled'
          : 'Auction clearing processed',
        data: result,
      });
    } catch (err) {
      logger.error({ err, loadId: req.params.id }, '[AuctionRoute] Failed to clear auction');
      return res.status(400).json({ error: err.message });
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
