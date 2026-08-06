import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// Mock dependencies objects
const mockOrder = {
  id: 'order-123',
  order_display_id: '#TRX12345',
  customer_id: 'customer-user-id',
  driver_id: 'driver-user-id',
  total_amount: 350000, // 3500 INR in Paisa
  drop_lat: 12.9716,
  drop_lng: 77.5946,
  escrow_status: 'pending',
};

const mockOrderRepository = {
  findOrderByAnyId: vi.fn(),
  findDriverWallet: vi.fn(),
  findCustomerWallet: vi.fn(),
  updateOrder: vi.fn(),
};

const mockOrderLifecycleService = {
  verifyDeliveryFn: vi.fn(),
};

const mockLockPayment = vi.fn();
const mockStoreDeliveryOtp = vi.fn();
const mockSendFcmNotification = vi.fn();

// Register mocks BEFORE importing routes
vi.mock('../../src/middleware/rateLimiter.js', () => ({
  userLimiter: (req, res, next) => next(),
}));

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, res, next) => {
    req.user = { id: req.headers['user-id'] || 'customer-user-id' };
    next();
  },
}));

vi.mock('../../src/core/container.js', () => ({
  orderRepository: {
    findOrderByAnyId: (...args) => mockOrderRepository.findOrderByAnyId(...args),
    findDriverWallet: (...args) => mockOrderRepository.findDriverWallet(...args),
    findCustomerWallet: (...args) => mockOrderRepository.findCustomerWallet(...args),
    updateOrder: (...args) => mockOrderRepository.updateOrder(...args),
  },
  orderLifecycleService: {
    verifyDeliveryFn: (...args) => mockOrderLifecycleService.verifyDeliveryFn(...args),
  },
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../src/services/escrow.js', () => ({
  lockPayment: (...args) => mockLockPayment(...args),
  paisaToMaticWei: (amount) => String(BigInt(amount) * 1000000000000n),
}));

vi.mock('../../src/services/notificationService.js', () => ({
  storeDeliveryOtp: (...args) => mockStoreDeliveryOtp(...args),
  sendFcmNotification: (...args) => mockSendFcmNotification(...args),
}));

// Import routes after registering mocks to avoid circular dependencies issues
const { default: paymentRoutes } = await import('../../src/routes/paymentRoutes.js');
const { default: deliveryRoutes } = await import('../../src/routes/deliveryRoutes.js');

// Setup a mock Express app for testing
const app = express();
app.use(express.json());
app.use('/api/payments', paymentRoutes);
app.use('/api/deliveries', deliveryRoutes);

describe('Payment & Escrow Endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock behavior
    mockOrderRepository.findOrderByAnyId.mockResolvedValue({ data: { ...mockOrder } });
    mockOrderRepository.findDriverWallet.mockResolvedValue({ data: { polygon_wallet_address: '0xDriverAddress' } });
    mockOrderRepository.findCustomerWallet.mockResolvedValue({ data: { polygon_wallet_address: '0xCustomerAddress' } });
    mockOrderRepository.updateOrder.mockResolvedValue({ error: null });
    mockLockPayment.mockResolvedValue({ txHash: '0xMockTxHash', bookingId: '0xMockBookingId' });
    mockStoreDeliveryOtp.mockResolvedValue(true);
    mockOrderLifecycleService.verifyDeliveryFn.mockResolvedValue({ escrowUpdateFailed: false });
    mockSendFcmNotification.mockResolvedValue({ success: true });
  });

  describe('POST /api/payments/lock', () => {
    it('successfully locks payment on-chain and updates DB', async () => {
      const res = await request(app)
        .post('/api/payments/lock')
        .set('user-id', 'customer-user-id')
        .send({
          bookingId: '#TRX12345',
          upiReference: 'UPI1234567890',
          amount: 350000,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.txHash).toBe('0xMockTxHash');
      expect(mockLockPayment).toHaveBeenCalledWith(
        '#TRX12345',
        '0xCustomerAddress',
        '0xDriverAddress',
        expect.any(String)
      );
      expect(mockOrderRepository.updateOrder).toHaveBeenCalledWith('order-123', expect.objectContaining({
        escrow_status: 'funded',
        upi_reference: 'UPI1234567890',
      }));
    });

    it('rejects if the user is not the customer of the order', async () => {
      mockOrderRepository.findOrderByAnyId.mockResolvedValue({
        data: { ...mockOrder, customer_id: 'some-other-user' },
      });

      const res = await request(app)
        .post('/api/payments/lock')
        .set('user-id', 'customer-user-id')
        .send({
          bookingId: '#TRX12345',
          upiReference: 'UPI1234567890',
          amount: 350000,
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Access Denied');
    });

    it('returns validation errors for missing or invalid parameters', async () => {
      const res = await request(app)
        .post('/api/payments/lock')
        .set('user-id', 'customer-user-id')
        .send({
          bookingId: '',
          amount: -100,
        });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/deliveries/:id/confirm-otp', () => {
    it('releases escrow payment successfully via 4-digit OTP', async () => {
      const res = await request(app)
        .post('/api/deliveries/order-123/confirm-otp')
        .set('user-id', 'driver-user-id')
        .send({
          otp: '1234',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockOrderLifecycleService.verifyDeliveryFn).toHaveBeenCalledWith(
        'order-123',
        'driver-user-id',
        '1234'
      );
      expect(mockSendFcmNotification).toHaveBeenCalledWith('driver-user-id', expect.objectContaining({
        title: 'Payment Released',
        body: '✓ ₹3500.00 credited',
      }));
    });

    it('auto-confirms delivery via GPS geofence fallback (within 500m)', async () => {
      // Lat/Lng is very close to Bangalore drop location (12.9716, 77.5946)
      const res = await request(app)
        .post('/api/deliveries/order-123/confirm-otp')
        .set('user-id', 'driver-user-id')
        .send({
          latitude: 12.9718,
          longitude: 77.5948,
        });

      expect(res.status).toBe(200);
      expect(res.body.isGeofenced).toBe(true);
      expect(mockStoreDeliveryOtp).toHaveBeenCalledWith('order-123', 'GEOF', 5);
      expect(mockOrderLifecycleService.verifyDeliveryFn).toHaveBeenCalledWith(
        'order-123',
        'driver-user-id',
        'GEOF'
      );
    });

    it('rejects with 400 if outside geofence and no OTP is provided', async () => {
      // Coordinates are far away (e.g. Mumbai)
      const res = await request(app)
        .post('/api/deliveries/order-123/confirm-otp')
        .set('user-id', 'driver-user-id')
        .send({
          latitude: 19.0760,
          longitude: 72.8777,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('OTP is required');
    });
  });
});
