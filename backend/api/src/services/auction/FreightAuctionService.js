import crypto from 'crypto';
import logger from '../../middleware/logger.js';
import {
  acquireLock,
  releaseLock,
  acquireDistributedLock,
  releaseDistributedLock,
  withLockRenewal,
  LockAcquisitionError,
} from '../../lib/redisLock.js';
import { redisClient, supabaseAdmin } from '../../config/db.js';
import { OrderRepository } from '../../repositories/orderRepository.js';

// Redis key prefix for persisted auction records.
// Each auction is stored as a JSON string at key: AUCTION_KEY_PREFIX + loadOfferId
const AUCTION_KEY_PREFIX = 'auction:state:';
const AUCTION_TTL_S = 24 * 60 * 60; // 24 hours

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
    // Process-local map used ONLY when Redis is unavailable (single-instance fallback).
    // When Redis is configured, all state is read/written there so every instance
    // observes the same auction — preventing split-brain double-settlement.
    this._localAuctions = new Map();
    this.orderRepository =
      options.orderRepository ||
      (supabaseAdmin ? new OrderRepository(supabaseAdmin) : null);
  }

  get auctions() {
    return this._localAuctions;
  }

  // ─── Redis-backed state helpers ───────────────────────────────────────────

  async _getAuction(loadOfferId) {
    if (redisClient) {
      try {
        const raw = await redisClient.get(AUCTION_KEY_PREFIX + loadOfferId);
        return raw ? JSON.parse(raw) : null;
      } catch (err) {
        logger.warn({ err, loadOfferId }, '[FreightAuction] Redis read failed; using local fallback');
      }
    }
    return this._localAuctions.get(loadOfferId) ?? null;
  }

  async _setAuction(loadOfferId, auction) {
    if (redisClient) {
      try {
        await redisClient.set(
          AUCTION_KEY_PREFIX + loadOfferId,
          JSON.stringify(auction),
          'EX',
          AUCTION_TTL_S
        );
        return;
      } catch (err) {
        logger.error({ err, loadOfferId }, '[FreightAuction] Redis write failed');
        throw err;
      }
    }
    this._localAuctions.set(loadOfferId, auction);
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
    // Use Number.isFinite to distinguish a genuine 0 rating from undefined/NaN,
    // so a 0-rated driver doesn't silently receive the 80-point default.
    const numericRating = Number(driverRating);
    const clampedRating = Math.max(0, Math.min(100, Number.isFinite(numericRating) ? numericRating : 80));
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
   * Compensates a failed or aborted bid submission by removing the bid from auction state
   * and releasing the reserved collateral lock so the driver can retry cleanly.
   *
   * @param {string} loadOfferId
   * @param {string} driverId
   * @param {string|null} [token]
   */
  async compensateFailedBid(loadOfferId, driverId, token = null) {
    try {
      const auction = await this._getAuction(loadOfferId);
      if (auction && Array.isArray(auction.bids)) {
        auction.bids = auction.bids.filter(b => b.driverId !== driverId);
        await this._setAuction(loadOfferId, auction);
      }
    } catch (err) {
      logger.warn({ err, loadOfferId }, '[FreightAuction] Failed to update auction state during compensation');
    }
    const collateralKey = `auction:collateral:${driverId}:${loadOfferId}`;
    try {
      await releaseDistributedLock(collateralKey, token);
    } catch (err) {
      logger.warn({ err, collateralKey }, '[FreightAuction] Failed to release collateral during compensation');
    }
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
    const lockValue = await acquireLock(lockKey, 10000);
    if (!lockValue) {
      throw new Error('Concurrent auction initialization in progress');
    }

    try {
      const existing = await this._getAuction(loadOfferId);
      if (existing) {
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

      await this._setAuction(loadOfferId, auctionRecord);
      logger.info({ loadOfferId, reservePrice, scheduledCloseAt }, '[FreightAuction] Auction opened successfully');
      return auctionRecord;
    } finally {
      await releaseLock(lockKey, lockValue);
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
    const loadLockValue = await acquireLock(loadLockKey, 10000);
    if (!loadLockValue) {
      throw new Error('Concurrent bid processing in progress. Please retry.');
    }

    try {
      return await withLockRenewal(loadLockKey, loadLockValue, 10000, async (signal) => {
        const auction = await this._getAuction(loadOfferId);
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

        // 2. Compute multi-criteria utility score
        const utilityScore = this.calculateUtilityScore({
          bidAmount,
          reservePrice: auction.reservePrice,
          driverRating,
          detourKm,
        });

        // 3. Anti-Sniping Soft-Close Window Evaluation
        // Pre-compute whether an extension is warranted so the collateral lock TTL
        // covers the fully extended closing time (addressing CodeRabbit comment 7).
        let antiSnipingTriggered = false;
        let effectiveCloseAt = auction.currentCloseAt;
        let newExtensionsCount = auction.extensionsCount;
        const timeRemainingMs = auction.currentCloseAt - now;

        if (timeRemainingMs <= auction.antiSnipingWindowMs) {
          const currentBestBid = auction.bids.length > 0
            ? auction.bids.reduce((prev, curr) => (curr.utilityScore > prev.utilityScore ? curr : prev), auction.bids[0])
            : null;

          const isCompetitive = !currentBestBid || utilityScore >= currentBestBid.utilityScore || bidAmount < currentBestBid.bidAmount;
          if (isCompetitive) {
            const maxAllowedClose = auction.scheduledCloseAt + AUCTION_CONFIG.MAX_EXTENSION_MS;
            const extendedCloseAt = Math.min(auction.currentCloseAt + auction.extensionMs, maxAllowedClose);

            if (extendedCloseAt > auction.currentCloseAt) {
              effectiveCloseAt = extendedCloseAt;
              newExtensionsCount += 1;
              antiSnipingTriggered = true;
            }
          }
        }

        // 4. Driver Solvency & Capacity Reservation Lock
        // Acquire lock with TTL covering the (potentially extended) auction close time.
        const remainingSeconds = Math.max(60, Math.ceil((effectiveCloseAt - now) / 1000));
        const collateralKey = `auction:collateral:${driverId}:${loadOfferId}`;
        const collateralLock = await acquireDistributedLock(collateralKey, remainingSeconds);
        if (!collateralLock.acquired) {
          throw new Error('Driver already has a conflicting collateral or capacity reservation for this auction');
        }

        let dbBid = null;

        try {
          if (signal?.aborted) {
            throw new LockAcquisitionError(loadLockKey, 'Lock ownership was lost during execution — protected operation aborted');
          }

          // Apply anti-sniping state update now that driver collateral is locked
          if (antiSnipingTriggered) {
            auction.currentCloseAt = effectiveCloseAt;
            auction.status = AUCTION_STATES.SOFT_CLOSE_EXTENDED;
            auction.extensionsCount = newExtensionsCount;
            logger.info(
              { loadOfferId, driverId, extendedCloseAt: effectiveCloseAt, extensionsCount: auction.extensionsCount },
              '[FreightAuction] Anti-sniping soft-close window extended'
            );
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

          // 5. Durable Bid Persistence: coordinate with orderRepository (load_bids table)
          if (this.orderRepository) {
            const { data, error: persistErr } = await this.orderRepository.createBid({
              load_id: loadOfferId,
              driver_id: driverId,
              bid_amount: bidAmount,
              status: 'pending',
            });

            if (persistErr) {
              throw new Error(`Failed to persist bid to database: ${persistErr.message || 'Database error'}`);
            }
            dbBid = data;
            if (data?.id) {
              bidRecord.dbBidId = data.id;
            }
          }

          if (signal?.aborted) {
            throw new LockAcquisitionError(loadLockKey, 'Lock ownership was lost during execution — protected operation aborted');
          }

          // 6. Redis State Persistence
          await this._setAuction(loadOfferId, auction);

          return {
            success: true,
            bid: bidRecord,
            dbBid,
            auctionStatus: auction.status,
            currentCloseAt: auction.currentCloseAt,
            antiSnipingTriggered,
          };
        } catch (err) {
          await collateralLock.release();
          await this.compensateFailedBid(loadOfferId, driverId, collateralLock.token);
          if (this.orderRepository && dbBid?.id && typeof this.orderRepository.deleteBid === 'function') {
            try {
              await this.orderRepository.deleteBid(dbBid.id);
            } catch (delErr) {
              logger.error({ delErr, dbBidId: dbBid.id }, '[FreightAuction] Failed to roll back db bid on failure');
            }
          }
          throw err;
        }
      });
    } finally {
      await releaseLock(loadLockKey, loadLockValue);
    }
  }

  /**
   * Execute multi-criteria reverse-auction clearing and second-price settlement.
   */
  async clearAuction(loadOfferId, options = {}) {
    const { force = false } = options;
    const loadLockKey = `lock:auction:load:${loadOfferId}`;
    const loadLockValue = await acquireLock(loadLockKey, 15000);
    if (!loadLockValue) {
      throw new Error('Concurrent auction clearing in progress');
    }

    try {
      return await withLockRenewal(loadLockKey, loadLockValue, 15000, async (signal) => {
        const auction = await this._getAuction(loadOfferId);
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
          await this._setAuction(loadOfferId, auction);
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
        let settlementPrice = winningBid.bidAmount;
        if (sortedBids.length >= 2) {
          const losingBidAmounts = sortedBids.slice(1).map(b => b.bidAmount);
          const secondLowestPrice = Math.min(...losingBidAmounts);
          settlementPrice = Math.min(
            auction.reservePrice,
            Math.max(winningBid.bidAmount, secondLowestPrice)
          );
        }

        if (signal?.aborted) {
          throw new LockAcquisitionError(loadLockKey, 'Lock ownership was lost during clearing');
        }

        auction.winningBid = winningBid;
        auction.settlementPrice = settlementPrice;
        auction.status = AUCTION_STATES.SETTLED;
        auction.settledAt = now;

        await this._setAuction(loadOfferId, auction);

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
      });
    } finally {
      await releaseLock(loadLockKey, loadLockValue);
    }
  }

  /**
   * Fetch current public state of the auction.
   */
  async getAuctionStatus(loadOfferId) {
    const auction = await this._getAuction(loadOfferId);
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
        await releaseDistributedLock(key);
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
        await releaseDistributedLock(key);
      } catch (err) {
        logger.warn({ err, key }, '[FreightAuction] Failed to release collateral lock');
      }
    }
  }
}

export const freightAuctionService = new FreightAuctionService();
