import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// Define mutable mocks
let mockFindOrder = vi.fn();
let mockGetEscrowBooking = vi.fn();

vi.mock('../../src/core/container.js', () => ({
  orderValidationService: {
    findOrderByIdOrDisplayId: (...args) => mockFindOrder(...args)
  }
}));

vi.mock('../../src/services/escrow.js', () => ({
  getEscrowBookingId: (id) => `booking-${id}`,
  getEscrowBooking: (...args) => mockGetEscrowBooking(...args)
}));

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, res, next) => {
    req.user = {
      id: req.headers['x-user-id'] || 'customer-123',
      role: req.headers['x-user-role'] || 'customer'
    };
    next();
  }
}));

const { default: blockchainRouter } = await import('../../src/routes/blockchainRoutes.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/blockchain', blockchainRouter);
  return app;
}

describe('GET /api/blockchain/receipt/:tripId', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
    mockFindOrder.mockReset();
    mockGetEscrowBooking.mockReset();
  });

  it('returns 200 and receipt data when requester is the customer', async () => {
    mockFindOrder.mockResolvedValue({
      id: 'order-123',
      order_display_id: 'OD-123',
      customer_id: 'customer-123',
      driver_id: 'driver-456',
      pickup_address: 'Point A',
      drop_address: 'Point B',
      total_amount: 15000,
      blockchain_tx_hash: '0xabc123',
      escrow_booking_id: 'booking-OD-123',
      status: 'completed',
      completed_at: '2026-08-06T12:00:00Z',
      created_at: '2026-08-06T10:00:00Z'
    });

    mockGetEscrowBooking.mockResolvedValue({
      driver: '0xDriverWalletAddress'
    });

    const res = await request(app)
      .get('/api/blockchain/receipt/OD-123')
      .set('x-user-id', 'customer-123')
      .set('x-user-role', 'customer');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      orderId: 'OD-123',
      origin: 'Point A',
      destination: 'Point B',
      price: 15000,
      driver: '0xDriverWalletAddress',
      timestamp: '2026-08-06T12:00:00Z',
      txHash: '0xabc123'
    });
  });

  it('returns 200 and receipt data when requester is the driver', async () => {
    mockFindOrder.mockResolvedValue({
      id: 'order-123',
      order_display_id: 'OD-123',
      customer_id: 'customer-123',
      driver_id: 'driver-456',
      pickup_address: 'Point A',
      drop_address: 'Point B',
      total_amount: 15000,
      blockchain_tx_hash: '0xabc123',
      escrow_booking_id: 'booking-OD-123',
      status: 'completed',
      completed_at: '2026-08-06T12:00:00Z',
      created_at: '2026-08-06T10:00:00Z'
    });

    mockGetEscrowBooking.mockResolvedValue(null); // fallback to driver_id

    const res = await request(app)
      .get('/api/blockchain/receipt/OD-123')
      .set('x-user-id', 'driver-456')
      .set('x-user-role', 'driver');

    expect(res.status).toBe(200);
    expect(res.body.driver).toBe('driver-456');
  });

  it('returns 403 Forbidden when requester is not owner, driver, or admin', async () => {
    mockFindOrder.mockResolvedValue({
      id: 'order-123',
      order_display_id: 'OD-123',
      customer_id: 'customer-123',
      driver_id: 'driver-456',
      pickup_address: 'Point A',
      drop_address: 'Point B',
      total_amount: 15000,
      blockchain_tx_hash: '0xabc123',
      escrow_booking_id: 'booking-OD-123',
      status: 'completed',
      completed_at: '2026-08-06T12:00:00Z',
      created_at: '2026-08-06T10:00:00Z'
    });

    const res = await request(app)
      .get('/api/blockchain/receipt/OD-123')
      .set('x-user-id', 'other-user')
      .set('x-user-role', 'customer');

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Unauthorized to view this order receipt');
  });

  it('returns 404 Not Found when order does not exist', async () => {
    mockFindOrder.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/blockchain/receipt/OD-999')
      .set('x-user-id', 'customer-123')
      .set('x-user-role', 'customer');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Order not found');
  });
});
