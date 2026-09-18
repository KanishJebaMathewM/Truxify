import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FreightAuctionService, AUCTION_STATES, AUCTION_CONFIG } from '../../src/services/auction/FreightAuctionService.js';
import * as lockFallback from '../../src/lib/lockFallback.js';

describe('FreightAuctionService - Real-Time Dynamic Reverse Auction Engine', () => {
  let auctionService;

  beforeEach(() => {
    auctionService = new FreightAuctionService();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('1. Auction Initialization (openAuction)', () => {
    it('should successfully initialize an auction in AUCTION_OPEN state', async () => {
      const loadOfferId = 'load-101';
      const shipperId = 'shipper-abc';
      const reservePrice = 5000000; // ₹50,000.00 in paisa

      const auction = await auctionService.openAuction({
        loadOfferId,
        shipperId,
        reservePrice,
        durationMs: 1800000, // 30 mins
      });

      expect(auction).toBeDefined();
      expect(auction.loadOfferId).toBe(loadOfferId);
      expect(auction.shipperId).toBe(shipperId);
      expect(auction.reservePrice).toBe(reservePrice);
      expect(auction.status).toBe(AUCTION_STATES.AUCTION_OPEN);
      expect(auction.bids).toHaveLength(0);
      expect(auction.currentCloseAt).toBeGreaterThan(Date.now());
    });

    it('should reject auction initialization with invalid reserve price', async () => {
      await expect(
        auctionService.openAuction({
          loadOfferId: 'load-invalid-price',
          shipperId: 'shipper-abc',
          reservePrice: 0,
        })
      ).rejects.toThrow('reservePrice must be greater than zero');
    });

    it('should reject opening a duplicate auction while one is already active', async () => {
      const loadOfferId = 'load-duplicate';
      await auctionService.openAuction({
        loadOfferId,
        shipperId: 'shipper-1',
        reservePrice: 1000000,
      });

      await expect(
        auctionService.openAuction({
          loadOfferId,
          shipperId: 'shipper-1',
          reservePrice: 1000000,
        })
      ).rejects.toThrow(`Auction for load ${loadOfferId} is already open`);
    });
  });

  describe('2. Multi-Objective Utility Scoring (calculateUtilityScore)', () => {
    it('should score lower bids higher when all other factors are equal', () => {
      const reservePrice = 100000;
      const lowBidScore = auctionService.calculateUtilityScore({
        bidAmount: 70000, // 30% discount
        reservePrice,
        driverRating: 80,
        detourKm: 5,
      });

      const highBidScore = auctionService.calculateUtilityScore({
        bidAmount: 90000, // 10% discount
        reservePrice,
        driverRating: 80,
        detourKm: 5,
      });

      expect(lowBidScore).toBeGreaterThan(highBidScore);
    });

    it('should reward high driver reputation and penalize long detour distances', () => {
      const reservePrice = 100000;
      const highRepNearScore = auctionService.calculateUtilityScore({
        bidAmount: 80000,
        reservePrice,
        driverRating: 98,
        detourKm: 2,
      });

      const lowRepFarScore = auctionService.calculateUtilityScore({
        bidAmount: 80000,
        reservePrice,
        driverRating: 60,
        detourKm: 40,
      });

      expect(highRepNearScore).toBeGreaterThan(lowRepFarScore);
    });

    it('should not treat a genuine rating of 0 as the default rating of 80', () => {
      const reservePrice = 100000;
      // A driver with rating 0 must score lower than a driver with rating 80.
      const zeroRatingScore = auctionService.calculateUtilityScore({
        bidAmount: 80000,
        reservePrice,
        driverRating: 0,
        detourKm: 0,
      });
      const defaultRatingScore = auctionService.calculateUtilityScore({
        bidAmount: 80000,
        reservePrice,
        driverRating: 80,
        detourKm: 0,
      });
      expect(zeroRatingScore).toBeLessThan(defaultRatingScore);
    });
  });

  describe('3. Bid Submission & Solvency Controls (submitBid)', () => {
    let loadOfferId;
    const reservePrice = 1000000; // ₹10,000

    beforeEach(async () => {
      loadOfferId = `load-${Date.now()}`;
      await auctionService.openAuction({
        loadOfferId,
        shipperId: 'shipper-1',
        reservePrice,
        durationMs: 600000, // 10 mins
      });
    });

    it('should accept a valid qualifying bid within reserve ceiling', async () => {
      const result = await auctionService.submitBid({
        loadOfferId,
        driverId: 'driver-1',
        bidAmount: 850000,
        driverRating: 90,
        detourKm: 4,
      });

      expect(result.success).toBe(true);
      expect(result.bid.driverId).toBe('driver-1');
      expect(result.bid.bidAmount).toBe(850000);
      expect(result.bid.utilityScore).toBeGreaterThan(0);
    });

    it('should reject a bid that exceeds the reserve ceiling', async () => {
      await expect(
        auctionService.submitBid({
          loadOfferId,
          driverId: 'driver-greedy',
          bidAmount: 1200000, // Exceeds 1000000
        })
      ).rejects.toThrow(/exceeds shipper reserve ceiling/);
    });

    it('should reject duplicate bids from the same driver in the same auction', async () => {
      await auctionService.submitBid({
        loadOfferId,
        driverId: 'driver-dup',
        bidAmount: 800000,
      });

      await expect(
        auctionService.submitBid({
          loadOfferId,
          driverId: 'driver-dup',
          bidAmount: 750000,
        })
      ).rejects.toThrow(/already has an active bid/);
    });
  });

  describe('4. Anti-Sniping Soft-Close Protection', () => {
    it('should dynamically extend auction deadline if competitive bid arrives within soft-close window', async () => {
      const loadOfferId = 'load-anti-sniping';
      const durationMs = 120000; // 2 minutes
      const antiSnipingWindowMs = 180000; // 3 minutes window (so current time is already inside window)
      const extensionMs = 180000; // 3 minutes extension

      const initialAuction = await auctionService.openAuction({
        loadOfferId,
        shipperId: 'shipper-anti-sniping',
        reservePrice: 2000000,
        durationMs,
        antiSnipingWindowMs,
        extensionMs,
      });

      const originalCloseAt = initialAuction.currentCloseAt;

      // Submit competitive bid within soft-close window
      const bidResult = await auctionService.submitBid({
        loadOfferId,
        driverId: 'driver-sniper-bot',
        bidAmount: 1500000,
        driverRating: 95,
      });

      expect(bidResult.antiSnipingTriggered).toBe(true);
      expect(bidResult.auctionStatus).toBe(AUCTION_STATES.SOFT_CLOSE_EXTENDED);
      expect(bidResult.currentCloseAt).toBeGreaterThan(originalCloseAt);
      expect(bidResult.currentCloseAt - originalCloseAt).toBe(extensionMs);

      const status = auctionService.getAuctionStatus(loadOfferId);
      expect(status.extensionsCount).toBe(1);
      expect(status.status).toBe(AUCTION_STATES.SOFT_CLOSE_EXTENDED);
    });
  });

  describe('5. Multi-Objective Reverse Auction Clearing (clearAuction)', () => {
    it('should cancel auction if no qualifying bids were submitted', async () => {
      const loadOfferId = 'load-no-bids';
      await auctionService.openAuction({
        loadOfferId,
        shipperId: 'shipper-1',
        reservePrice: 500000,
        durationMs: 1000,
      });

      const clearResult = await auctionService.clearAuction(loadOfferId, { force: true });
      expect(clearResult.status).toBe(AUCTION_STATES.CANCELLED_UNMET_RESERVE);
      expect(clearResult.reason).toContain('Insufficient qualifying bids');
    });

    it('should execute second-price reverse settlement with multi-criteria selection', async () => {
      const loadOfferId = 'load-multi-bid';
      const reservePrice = 1000000; // ₹10,000

      await auctionService.openAuction({
        loadOfferId,
        shipperId: 'shipper-1',
        reservePrice,
        durationMs: 1000,
      });

      // Driver A: ₹7,000 bid, excellent reputation (95), zero detour (0km)
      await auctionService.submitBid({
        loadOfferId,
        driverId: 'driver-A',
        bidAmount: 700000,
        driverRating: 95,
        detourKm: 0,
      });

      // Driver B: ₹8,000 bid, lower reputation (75), 15km detour
      await auctionService.submitBid({
        loadOfferId,
        driverId: 'driver-B',
        bidAmount: 800000,
        driverRating: 75,
        detourKm: 15,
      });

      // Driver C: ₹9,000 bid
      await auctionService.submitBid({
        loadOfferId,
        driverId: 'driver-C',
        bidAmount: 900000,
        driverRating: 70,
        detourKm: 20,
      });

      const clearResult = await auctionService.clearAuction(loadOfferId, { force: true });

      expect(clearResult.status).toBe(AUCTION_STATES.SETTLED);
      expect(clearResult.winningBid.driverId).toBe('driver-A');

      // Second-price reverse settlement:
      // Winning carrier (Driver A) submitted ₹7,000, second-best qualifying bid was Driver B at ₹8,000.
      // Settle at second-lowest bid to ensure truthful bidding mechanism!
      expect(clearResult.settlementPrice).toBe(800000);
      expect(clearResult.totalBids).toBe(3);

      const status = auctionService.getAuctionStatus(loadOfferId);
      expect(status.status).toBe(AUCTION_STATES.SETTLED);
      expect(status.winningBid.driverId).toBe('driver-A');
    });

    it('should settle at own bid if only a single qualifying bid exists', async () => {
      const loadOfferId = 'load-single-bid';
      await auctionService.openAuction({
        loadOfferId,
        shipperId: 'shipper-1',
        reservePrice: 1000000,
        durationMs: 1000,
      });

      await auctionService.submitBid({
        loadOfferId,
        driverId: 'driver-solo',
        bidAmount: 850000,
      });

      const clearResult = await auctionService.clearAuction(loadOfferId, { force: true });
      expect(clearResult.status).toBe(AUCTION_STATES.SETTLED);
      expect(clearResult.winningBid.driverId).toBe('driver-solo');
      expect(clearResult.settlementPrice).toBe(850000);
    });
  });

  describe('6. Concurrency Serialization Test', () => {
    it('serialized local-fallback mode: all 10 bids accepted with unique bidIds', async () => {
      // In this test Redis is unavailable so acquireLockOrFallback queues callers
      // via the in-process mutex — all 10 bids MUST succeed sequentially.
      // Simulate Redis unavailability by making acquireLockOrFallback use local queue.
      vi.spyOn(lockFallback, 'acquireLockOrFallback').mockImplementation(async (key, ttlMs) => {
        // Resolve immediately with a local serialised lock (no actual Redis)
        let release;
        const gate = new Promise(r => { release = r; });
        // Allow one caller at a time (simulate local queue drain for test speed)
        const handle = { ok: true, release: async () => release() };
        return Promise.resolve(handle);
      });

      const loadOfferId = 'load-local-concurrent';
      await auctionService.openAuction({
        loadOfferId,
        shipperId: 'shipper-concurrent',
        reservePrice: 2000000,
        durationMs: 600000,
      });

      const concurrentDrivers = Array.from({ length: 10 }, (_, i) => ({
        loadOfferId,
        driverId: `local-driver-${i}`,
        bidAmount: 1000000 + i * 10000,
        driverRating: 80 + (i % 20),
        detourKm: i * 2,
      }));

      // Run sequentially (not all at once) to deterministically test the fallback path
      const results = [];
      for (const bid of concurrentDrivers) {
        results.push(await auctionService.submitBid(bid));
      }

      // All 10 bids must succeed in serialised fallback mode
      expect(results).toHaveLength(10);
      results.forEach(r => expect(r.success).toBe(true));

      const bidIds = results.map(r => r.bid.bidId);
      const uniqueBidIds = new Set(bidIds);
      expect(uniqueBidIds.size).toBe(10); // All bidIds must be unique

      // Exactly one record per driver
      const status = await auctionService._getAuction(loadOfferId);
      expect(status.bids).toHaveLength(10);
      const driverIds = status.bids.map(b => b.driverId);
      expect(new Set(driverIds).size).toBe(10);
    });

    it('Redis contention mode: exactly 1 bid accepted, 9 rejected as concurrent', async () => {
      // When Redis holds the load lock, acquireLockOrFallback returns ok:false for
      // all but the first caller — only ONE bid should succeed.
      let lockHeld = false;
      vi.spyOn(lockFallback, 'acquireLockOrFallback').mockImplementation(async () => {
        if (lockHeld) {
          // Lock already held by first caller — reject remaining callers
          return { ok: false, release: async () => {} };
        }
        lockHeld = true;
        return {
          ok: true,
          release: async () => { lockHeld = false; },
        };
      });

      const loadOfferId = 'load-redis-contention';
      await auctionService.openAuction({
        loadOfferId,
        shipperId: 'shipper-contention',
        reservePrice: 2000000,
        durationMs: 600000,
      });

      const bids = Array.from({ length: 10 }, (_, i) => ({
        loadOfferId,
        driverId: `contention-driver-${i}`,
        bidAmount: 1000000 + i * 10000,
        driverRating: 80,
        detourKm: 0,
      }));

      // Fire all 10 simultaneously
      const settled = await Promise.allSettled(
        bids.map(bid => auctionService.submitBid(bid))
      );

      const fulfilled = settled.filter(r => r.status === 'fulfilled');
      const rejected = settled.filter(r => r.status === 'rejected');

      // Exactly 1 bid accepted, exactly 9 rejected as concurrent
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(9);

      // The one successful bid must have a unique bidId
      expect(fulfilled[0].value.bid.bidId).toBeDefined();

      // All rejections must be the 'concurrent' error, not a logic error
      rejected.forEach(r => {
        expect(r.reason.message).toMatch(/Concurrent bid processing in progress/);
      });
    });
  });
});
