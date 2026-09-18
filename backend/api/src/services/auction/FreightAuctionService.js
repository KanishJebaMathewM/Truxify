import crypto from 'crypto';
import logger from '../../middleware/logger.js';
import { acquireLockOrFallback } from '../../lib/lockFallback.js';
import { acquireDistributedLock } from '../../lib/redisLock.js';
import { redisClient } from '../../config/db.js';

export const AUCTION_STATES = Object.freeze({
  AUCTION_OPEN: 'AUCTION_OPEN',
  SOFT_CLOSE_EXTENDED: 'SOFT_CLOSE_EXTENDED',
  CLEARING_EVALUATION: 'CLEARING_EVALUATION',
  SETTLED: 'SETTLED',
  CANCELLED_UNMET_RESERVE: 'CANCELLED_UNMET_RESERVE',
  CANCELLED_BY_SHIPPER: 'CANCELLED_BY_SHIPPER',
});

export const AUCTION_CONFIG = Object.freeze({
  DEFAULT_DURATION_MS: 30 * 60 * 1000,          // 30 minutes
  ANTI_SNIPING_WINDOW_MS: 5 * 60 * 1000,         // 5 minutes (300 seconds)
  ANTI_SNIPING_EXTENSION_MS: 3 * 60 * 1000,      // 3 minutes (180 seconds)
  MAX_EXTENSION_MS: 30 * 60 * 1000,              // Up to 30 min extra extensions
  MIN_BIDS_REQUIRED: 1,
  WEIGHT_PRICE: 0.60,
  WEIGHT_REPUTATION: 0.25,
  WEIGHT_PROXIMITY: 0.15,
});

export class FreightAuctionService {
  constructor(options = {}) {
    this.auctions = new Map(); // In-memory state store (backed by Redis cache when available)
    this.orderRepository = options.orderRepository || null;
  }

  /**
   * Calculate multi-objective utility score for a reverse auction bid.
   * Higher utility score indicates a more optimal match for the shipper.
   *
   * @param {Object} params
   * @param {number} params.bidAmount - Bid amount in paisa or cents
   * @param {number} params.reservePrice - Maximum ceiling price set by shipper
   * @param {number} [params.driverRating=80] - Driver reputation score (0-100)
   * @param {number} [params.detourKm=0] - Detour distance in km
   * @returns {number} Utility score (0.0 to 1.0+)
   */
  calculateUtilityScore({ bidAmount, reservePrice, driverRating = 80, detourKm = 0 }) {
    if (reservePrice <= 0 || bidAmount <= 0) return 0;
    
    // Normalized price discount component (0 to 1)
    const priceRatio = Math.max(0, 1 - (bidAmount / reservePrice));
    
    // Normalized driver reputation component (0 to 1)
    const clampedRating = Math.max(0, Math.min(100, Number(driverRating) || 80));
    const reputationScore = clampedRating / 100;
    
    // Non-linear proximity penalty curve (1 at 0km detour, decreases with distance)
    const nonNegativeDetour = Math.max(0, Number(detourKm) || 0);
    const proximityScore = 1 / (1 + (nonNegativeDetour / 10)); // 10km half-life
    
    const utility = (
      (AUCTION_CONFIG.WEIGHT_PRICE * priceRatio) +
      (AUCTION_CONFIG.WEIGHT_REPUTATION * reputationScore) +
      (AUCTION_CONFIG.WEIGHT_PROXIMITY * proximityScore)
    );

    return parseFloat(utility.toFixed(4));
  }

  /**
   * Initialize a new freight reverse auction for a load listing.
   */
  async openAuction({
    loadOfferId,
    shipperId,
    reservePrice,
    durationMs = AUCTION_CONFIG.DEFAULT_DURATION_MS,
    antiSnipingWindowMs = AUCTION_CONFIG.ANTI_SNIPING_WINDOW_MS,
    extensionMs = AUCTION_CONFIG.ANTI_SNIPING_EXTENSION_MS,
    minBidsRequired = AUCTION_CONFIG.MIN_BIDS_REQUIRED,
  }) {
    if (!loadOfferId) throw new Error('loadOfferId is required');
    if (!reservePrice || reservePrice <= 0) throw new Error('reservePrice must be greater than zero');

    const lockKey = `lock:auction:load:${loadOfferId}`;
    const lock = await acquireLockOrFallback(lockKey, 10000);
    if (!lock.ok) {
      throw new Error('Concurrent auction initialization in progress');
    }

    try {
      if (this.auctions.has(loadOfferId)) {
        const existing = this.auctions.get(loadOfferId);
        if ([AUCTION_STATES.AUCTION_OPEN, AUCTION_STATES.SOFT_CLOSE_EXTENDED].includes(existing.status)) {
          throw new Error(`Auction for load ${loadOfferId} is already open`);
        }
      }

      const now = Date.now();
      const scheduledCloseAt = now + durationMs;

      const auctionRecord = {
        auctionId: crypto.randomUUID(),
        loadOfferId,
        shipperId,
        reservePrice,
        status: AUCTION_STATES.AUCTION_OPEN,
        createdAt: now,
        scheduledCloseAt,
        currentCloseAt: scheduledCloseAt,
        antiSnipingWindowMs,
        extensionMs,
        minBidsRequired,
        extensionsCount: 0,
        bids: [],
        winningBid: null,
        settlementPrice: null,
      };

      this.auctions.set(loadOfferId, auctionRecord);
      logger.info({ loadOfferId, reservePrice, scheduledCloseAt }, '[FreightAuction] Auction opened successfully');
      return auctionRecord;
    } finally {
      await lock.release();
    }
  }

  /**
   * Submit a bid with load-level mutual exclusion, anti-sniping protection, and solvency locking.
   */
  async submitBid({
    loadOfferId,
    driverId,
    bidAmount,
    driverRating = 80,
    detourKm = 0,
  }) {
    if (!loadOfferId || !driverId) throw new Error('loadOfferId and driverId are required');
    if (!bidAmount || bidAmount <= 0) throw new Error('bidAmount must be a positive number');

    // 1. Acquire Load-Level Mutual Exclusion to prevent front-running & race conditions
    const loadLockKey = `lock:auction:load:${loadOfferId}`;
    const loadLock = await acquireLockOrFallback(loadLockKey, 10000);
    if (!loadLock.ok) {
      throw new Error('Concurrent bid processing in progress. Please retry.');
    }

    try {
      const auction = this.auctions.get(loadOfferId);
      if (!auction) {
        throw new Error(`No active auction found for load ${loadOfferId}`);
      }

      const now = Date.now();
      if (![AUCTION_STATES.AUCTION_OPEN, AUCTION_STATES.SOFT_CLOSE_EXTENDED].includes(auction.status) || now >= auction.currentCloseAt) {
        throw new Error('Auction is closed for new bids');
      }

      if (bidAmount > auction.reservePrice) {
        throw new Error(`Bid amount ₹${(bidAmount / 100).toFixed(2)} exceeds shipper reserve ceiling ₹${(auction.reservePrice / 100).toFixed(2)}`);
      }

      // Check for duplicate pending bid from the same driver
      const existingBidIndex = auction.bids.findIndex(b => b.driverId === driverId);
      if (existingBidIndex !== -1) {
        throw new Error('Driver already has an active bid in this auction');
      }

      // 2. Driver Solvency & Capacity Reservation Lock
      // Atomically lock driver capacity for this load with TTL covering the remaining auction window
      const remainingSeconds = Math.max(60, Math.ceil((auction.currentCloseAt - now) / 1000));
      const collateralKey = `auction:collateral:${driverId}:${loadOfferId}`;
      const collateralLock = await acquireDistributedLock(collateralKey, remainingSeconds);
      if (!collateralLock.acquired) {
        throw new Error('Driver already has a conflicting collateral or capacity reservation for this auction');
      }

      // 3. Compute multi-criteria utility score
      const utilityScore = this.calculateUtilityScore({
        bidAmount,
        reservePrice: auction.reservePrice,
        driverRating,
        detourKm,
      });

      // 4. Anti-Sniping Soft-Close Window Evaluation
      let antiSnipingTriggered = false;
      const timeRemainingMs = auction.currentCloseAt - now;
      if (timeRemainingMs <= auction.antiSnipingWindowMs) {
        // Evaluate if this bid is competitive (beats the current best bid or improves pricing)
        const currentBestBid = auction.bids.length > 0
          ? auction.bids.reduce((prev, curr) => (curr.utilityScore > prev.utilityScore ? curr : prev), auction.bids[0])
          : null;

        const isCompetitive = !currentBestBid || utilityScore >= currentBestBid.utilityScore || bidAmount < currentBestBid.bidAmount;
        if (isCompetitive) {
          const maxAllowedClose = auction.scheduledCloseAt + AUCTION_CONFIG.MAX_EXTENSION_MS;
          const extendedCloseAt = Math.min(auction.currentCloseAt + auction.extensionMs, maxAllowedClose);

          if (extendedCloseAt > auction.currentCloseAt) {
            auction.currentCloseAt = extendedCloseAt;
            auction.status = AUCTION_STATES.SOFT_CLOSE_EXTENDED;
            auction.extensionsCount += 1;
            antiSnipingTriggered = true;
            logger.info(
              { loadOfferId, driverId, extendedCloseAt, extensionsCount: auction.extensionsCount },
              '[FreightAuction] Anti-sniping soft-close window extended'
            );
          }
        }
      }

      const bidRecord = {
        bidId: crypto.randomUUID(),
        loadOfferId,
        driverId,
        bidAmount,
        driverRating,
        detourKm,
        utilityScore,
        submittedAt: now,
        antiSnipingTriggered,
      };

      auction.bids.push(bidRecord);

      return {
        success: true,
        bid: bidRecord,
        auctionStatus: auction.status,
        currentCloseAt: auction.currentCloseAt,
        antiSnipingTriggered,
      };
    } finally {
      await loadLock.release();
    }
  }

  /**
   * Execute multi-criteria reverse-auction clearing and second-price settlement.
   */
  async clearAuction(loadOfferId, options = {}) {
    const { force = false } = options;
    const loadLockKey = `lock:auction:load:${loadOfferId}`;
    const loadLock = await acquireLockOrFallback(loadLockKey, 15000);
    if (!loadLock.ok) {
      throw new Error('Concurrent auction clearing in progress');
    }

    try {
      const auction = this.auctions.get(loadOfferId);
      if (!auction) {
        throw new Error(`Auction for load ${loadOfferId} not found`);
      }

      const now = Date.now();
      if (!force && now < auction.currentCloseAt) {
        throw new Error('Auction bidding window is still active');
      }

      if ([AUCTION_STATES.SETTLED, AUCTION_STATES.CANCELLED_UNMET_RESERVE].includes(auction.status)) {
        return {
          status: auction.status,
          winningBid: auction.winningBid,
          settlementPrice: auction.settlementPrice,
          message: 'Auction already finalized',
        };
      }

      auction.status = AUCTION_STATES.CLEARING_EVALUATION;

      if (!auction.bids || auction.bids.length < auction.minBidsRequired) {
        auction.status = AUCTION_STATES.CANCELLED_UNMET_RESERVE;
        await this._releaseAllCollateralLocks(auction);
        logger.warn({ loadOfferId }, '[FreightAuction] Auction cancelled — unmet minimum bids');
        return {
          status: AUCTION_STATES.CANCELLED_UNMET_RESERVE,
          reason: 'Insufficient qualifying bids meeting reserve price',
          bidsCount: auction.bids.length,
        };
      }

      // Sort bids by utilityScore DESC (best match first), tie-breaker: submittedAt ASC
      const sortedBids = [...auction.bids].sort((a, b) => {
        if (b.utilityScore !== a.utilityScore) {
          return b.utilityScore - a.utilityScore;
        }
        return a.submittedAt - b.submittedAt;
      });

      const winningBid = sortedBids[0];

      // Second-Price Reverse Auction Settlement:
      // Winning carrier receives either the second-best price (incentivizing truthful bidding)
      // or their own bid if only 1 bidder or if second bid is higher.
      let settlementPrice = winningBid.bidAmount;
      if (sortedBids.length >= 2) {
        const secondBestBid = sortedBids[1];
        // Settle at second-lowest bid or reserve ceiling
        settlementPrice = Math.min(auction.reservePrice, Math.max(winningBid.bidAmount, secondBestBid.bidAmount));
      }

      auction.winningBid = winningBid;
      auction.settlementPrice = settlementPrice;
      auction.status = AUCTION_STATES.SETTLED;
      auction.settledAt = now;

      // Release collateral locks for all losing carriers
      const losingBids = sortedBids.slice(1);
      await this._releaseLosingCollateralLocks(loadOfferId, losingBids);

      logger.info(
        { loadOfferId, winner: winningBid.driverId, settlementPrice, totalBids: sortedBids.length },
        '[FreightAuction] Auction cleared successfully'
      );

      return {
        status: AUCTION_STATES.SETTLED,
        winningBid,
        settlementPrice,
        totalBids: sortedBids.length,
        clearedAt: now,
      };
    } finally {
      await loadLock.release();
    }
  }

  /**
   * Fetch current public state of the auction.
   */
  getAuctionStatus(loadOfferId) {
    const auction = this.auctions.get(loadOfferId);
    if (!auction) return null;

    const now = Date.now();
    const timeRemainingMs = Math.max(0, auction.currentCloseAt - now);
    const bestBidAmount = auction.bids.length > 0
      ? Math.min(...auction.bids.map(b => b.bidAmount))
      : null;

    return {
      auctionId: auction.auctionId,
      loadOfferId: auction.loadOfferId,
      status: auction.status,
      reservePrice: auction.reservePrice,
      scheduledCloseAt: auction.scheduledCloseAt,
      currentCloseAt: auction.currentCloseAt,
      timeRemainingMs,
      bidsCount: auction.bids.length,
      bestBidAmount,
      extensionsCount: auction.extensionsCount,
      winningBid: auction.status === AUCTION_STATES.SETTLED ? auction.winningBid : null,
      settlementPrice: auction.status === AUCTION_STATES.SETTLED ? auction.settlementPrice : null,
    };
  }

  async _releaseLosingCollateralLocks(loadOfferId, losingBids) {
    for (const bid of losingBids) {
      const key = `auction:collateral:${bid.driverId}:${loadOfferId}`;
      try {
        if (redisClient && typeof redisClient.del === 'function') {
          await redisClient.del(key);
        }
      } catch (err) {
        logger.warn({ err, key }, '[FreightAuction] Failed to release losing collateral lock');
      }
    }
  }

  async _releaseAllCollateralLocks(auction) {
    if (!auction?.bids) return;
    for (const bid of auction.bids) {
      const key = `auction:collateral:${bid.driverId}:${auction.loadOfferId}`;
      try {
        if (redisClient && typeof redisClient.del === 'function') {
          await redisClient.del(key);
        }
      } catch (err) {
        logger.warn({ err, key }, '[FreightAuction] Failed to release collateral lock');
      }
    }
  }
}

export const freightAuctionService = new FreightAuctionService();
