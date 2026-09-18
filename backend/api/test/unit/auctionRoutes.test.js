import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { mockAuthenticate } = vi.hoisted(() => ({
  mockAuthenticate: vi.fn((req, _res, next) => {
    req.user = { id: 'test-user-id', role: 'carrier' };
    next();
  }),
}));

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, res, next) => mockAuthenticate(req, res, next),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import auctionRoutes from '../../src/routes/auctionRoutes.js';
import { freightAuctionService, AUCTION_STATES } from '../../src/services/auction/FreightAuctionService.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auctions', auctionRoutes);
  return app;
}

describe('Auction Routes API (/api/auctions)', () => {
  let app;

  beforeEach(() => {
    app = makeApp();
    freightAuctionService.auctions.clear();
    vi.clearAllMocks();
  });

  describe('POST /api/auctions/load/:id/open', () => {
    it('should open an auction successfully', async () => {
      const res = await request(app)
        .post('/api/auctions/load/load-route-1/open')
        .send({
          reservePrice: 500000,
          durationMs: 3600000,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.auction.loadOfferId).toBe('load-route-1');
      expect(res.body.auction.reservePrice).toBe(500000);
      expect(res.body.auction.status).toBe(AUCTION_STATES.AUCTION_OPEN);
    });

    it('should reject open auction with invalid input', async () => {
      const res = await request(app)
        .post('/api/auctions/load/load-route-1/open')
        .send({
          reservePrice: -10, // Invalid negative
        });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/auctions/load/:id/bid', () => {
    beforeEach(async () => {
      await freightAuctionService.openAuction({
        loadOfferId: 'load-bid-route',
        shipperId: 'shipper-1',
        reservePrice: 1000000,
      });
    });

    it('should submit a valid bid and return success', async () => {
      const res = await request(app)
        .post('/api/auctions/load/load-bid-route/bid')
        .send({
          bidAmount: 800000,
          driverRating: 92,
          detourKm: 3,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.bid.bidAmount).toBe(800000);
      expect(res.body.data.bid.driverId).toBe('test-user-id');
    });

    it('should return 400 when bid exceeds reserve price', async () => {
      const res = await request(app)
        .post('/api/auctions/load/load-bid-route/bid')
        .send({
          bidAmount: 1500000, // Exceeds reserve
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('exceeds shipper reserve ceiling');
    });
  });

  describe('GET /api/auctions/load/:id/status', () => {
    it('should return 404 if auction not found', async () => {
      const res = await request(app).get('/api/auctions/load/nonexistent-load/status');
      expect(res.status).toBe(404);
    });

    it('should return public auction status and metrics', async () => {
      await freightAuctionService.openAuction({
        loadOfferId: 'load-status-route',
        shipperId: 'shipper-1',
        reservePrice: 750000,
      });

      const res = await request(app).get('/api/auctions/load/load-status-route/status');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.auction.status).toBe(AUCTION_STATES.AUCTION_OPEN);
      expect(res.body.auction.reservePrice).toBe(750000);
    });
  });

  describe('POST /api/auctions/load/:id/clear', () => {
    it('should clear auction with force option and calculate settlement', async () => {
      await freightAuctionService.openAuction({
        loadOfferId: 'load-clear-route',
        shipperId: 'shipper-1',
        reservePrice: 1000000,
      });

      await freightAuctionService.submitBid({
        loadOfferId: 'load-clear-route',
        driverId: 'driver-x',
        bidAmount: 700000,
        driverRating: 90,
      });

      const res = await request(app)
        .post('/api/auctions/load/load-clear-route/clear')
        .send({ force: true });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe(AUCTION_STATES.SETTLED);
      expect(res.body.data.winningBid.driverId).toBe('driver-x');
    });
  });
});
