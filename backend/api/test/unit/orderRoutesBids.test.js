import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import orderRoutes from '../../src/routes/orderRoutes.js';

const { svcMock } = vi.hoisted(() => ({
  svcMock: {
    submitBid: vi.fn(),
  },
}));

vi.mock('../../src/core/container.js', () => ({
  orderRepository: {},
  orderValidationService: {},
  orderTimelineService: {},
  orderMilestoneService: {},
  orderLifecycleService: svcMock,
  deliveryVerificationService: {},
  buildDepositTx: vi.fn(),
  recordDepositTx: vi.fn(),
  submitEscrowRefund: vi.fn(),
  confirmEscrowRefund: vi.fn(),
}));

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => { req.user = req.user || { id: 'u1' }; next(); },
  requireRole: () => (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/requirePolicy.js', () => ({
  requirePolicy: () => (_req, _res, next) => next(),
}));

import { DomainError } from '../../src/services/order/domainError.js';

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.user = { id: 'driver-1' };
  next();
});
app.use(orderRoutes);

describe('POST /api/orders/:id/bids', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    svcMock.submitBid.mockReset();
  });

  it('201: returns message and bid object', async () => {
    svcMock.submitBid.mockResolvedValue({ message: 'Bid submitted successfully.', bid: { id: 'b1', bid_amount: 50000 } });
    const res = await request(app)
      .post('/load-bid-1/bids')
      .send({ bid_amount: 50000 });
    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Bid submitted successfully.');
    expect(res.body.bid.id).toBe('b1');
    expect(svcMock.submitBid).toHaveBeenCalledWith('load-bid-1', 'driver-1', 50000);
  });

  it('400: validation error on invalid bid_amount', async () => {
    const res = await request(app)
      .post('/load-bid-1/bids')
      .send({ bid_amount: 0 });
    expect(res.status).toBe(400);
    expect(res.body.details).toBeDefined();
  });

  it('403: forwards DomainError from service', async () => {
    svcMock.submitBid.mockRejectedValue(new DomainError(403, { error: 'You cannot bid on your own load offer' }));
    const res = await request(app)
      .post('/load-own/bids')
      .send({ bid_amount: 50000 });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('You cannot bid on your own load offer');
  });

  it('404: forwards DomainError when load missing', async () => {
    svcMock.submitBid.mockRejectedValue(new DomainError(404, { error: 'Load offer not found.' }));
    const res = await request(app)
      .post('/nonexistent/bids')
      .send({ bid_amount: 50000 });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Load offer not found.');
  });

  it('409: forwards DomainError on duplicate bid', async () => {
    svcMock.submitBid.mockRejectedValue(new DomainError(409, { error: 'You already have a pending bid for this load.' }));
    const res = await request(app)
      .post('/load-dupe/bids')
      .send({ bid_amount: 50000 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('You already have a pending bid for this load.');
  });

  it('410: forwards DomainError when load no longer available', async () => {
    svcMock.submitBid.mockRejectedValue(new DomainError(410, { error: 'Load is no longer available for bidding.' }));
    const res = await request(app)
      .post('/load-assigned/bids')
      .send({ bid_amount: 50000 });
    expect(res.status).toBe(410);
    expect(res.body.error).toBe('Load is no longer available for bidding.');
  });

  it('500: server error on unexpected failure', async () => {
    svcMock.submitBid.mockRejectedValue(new Error('boom'));
    const res = await request(app)
      .post('/load-bid-1/bids')
      .send({ bid_amount: 50000 });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal Server Error.');
  });
});
