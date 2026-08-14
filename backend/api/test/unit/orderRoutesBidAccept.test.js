import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import orderRoutes from '../../src/routes/orderRoutes.js';

const { svcMock, auditMock, idemMock } = vi.hoisted(() => ({
  svcMock: {
    getBidsForOrder: vi.fn(),
    acceptBid: vi.fn(),
  },
  auditMock: { auditLog: vi.fn(() => (req, _res, next) => next()) },
  idemMock: { requireIdempotency: vi.fn(() => (_req, _res, next) => next()) },
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

vi.mock('../../src/middleware/auditLog.js', () => auditMock);
vi.mock('../../src/middleware/idempotency.js', () => idemMock);

import { DomainError } from '../../src/services/order/domainError.js';

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.user = { id: 'customer-1' };
  next();
});
app.use(orderRoutes);

describe('GET /api/orders/:id/bids', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    svcMock.getBidsForOrder.mockReset();
  });

  it('200: returns enriched bids array', async () => {
    svcMock.getBidsForOrder.mockResolvedValue([{ id: 'b1', bid_amount: 50000, driver: { id: 'd1', name: 'Driver One' } }]);
    const res = await request(app).get('/order-view-1/bids');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].driver.name).toBe('Driver One');
    expect(svcMock.getBidsForOrder).toHaveBeenCalledWith('order-view-1', 'customer-1');
  });

  it('200: returns empty array when no bids', async () => {
    svcMock.getBidsForOrder.mockResolvedValue([]);
    const res = await request(app).get('/order-view-2/bids');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('403: forwards DomainError for non-owner', async () => {
    svcMock.getBidsForOrder.mockRejectedValue(new DomainError(403, { error: 'Access Denied: You do not own this order.' }));
    const res = await request(app).get('/order-view-3/bids');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Access Denied: You do not own this order.');
  });

  it('500: server error on unexpected failure', async () => {
    svcMock.getBidsForOrder.mockRejectedValue(new Error('boom'));
    const res = await request(app).get('/order-view-4/bids');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal Server Error.');
  });
});

describe('POST /api/orders/:id/bids/:bidId/accept', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    svcMock.acceptBid.mockReset();
  });

  it('200: returns depositTx from service', async () => {
    svcMock.acceptBid.mockResolvedValue({
      status: 200,
      body: { message: 'Bid reserved.', depositTx: { to: '0xescrow', data: '0xdeadbeef' } },
    });
    const res = await request(app).post('/order-accept-1/bids/bid-accept-1/accept');
    expect(res.status).toBe(200);
    expect(res.body.depositTx.to).toBe('0xescrow');
    expect(svcMock.acceptBid).toHaveBeenCalledWith('order-accept-1', 'bid-accept-1', 'customer-1');
  });

  it('403: forwards DomainError when bid not on this order', async () => {
    svcMock.acceptBid.mockRejectedValue(new DomainError(403, { error: 'Access Denied: Bid does not belong to this order.' }));
    const res = await request(app).post('/order-accept-2/bids/bid-accept-2/accept');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Access Denied: Bid does not belong to this order.');
  });

  it('404: forwards DomainError when order or bid missing', async () => {
    svcMock.acceptBid.mockRejectedValue(new DomainError(404, { error: 'Bid is not active or not found.' }));
    const res = await request(app).post('/order-accept-3/bids/bid-accept-3/accept');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Bid is not active or not found.');
  });

  it('422: forwards DomainError when wallet missing', async () => {
    svcMock.acceptBid.mockRejectedValue(new DomainError(422, { error: 'Both customer and driver must connect a wallet before escrow can be initiated.' }));
    const res = await request(app).post('/order-accept-4/bids/bid-accept-4/accept');
    expect(res.status).toBe(422);
  });

  it('500: server error on unexpected failure', async () => {
    svcMock.acceptBid.mockRejectedValue(new Error('boom'));
    const res = await request(app).post('/order-accept-5/bids/bid-accept-5/accept');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal Server Error');
  });
});
