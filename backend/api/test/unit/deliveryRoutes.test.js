import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

let mockUser = { id: 'usr-driver-101', role: 'driver' };

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => {
    req.user = mockUser;
    next();
  },
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  userLimiter: (_req, _res, next) => next(),
}));

const orderRepositoryMock = vi.hoisted(() => ({
  findOrderByAnyId: vi.fn(),
  updateOrderPod: vi.fn(),
}));

const orderLifecycleServiceMock = vi.hoisted(() => ({
  verifyDeliveryFn: vi.fn(),
}));

vi.mock('../../src/core/container.js', () => ({
  orderRepository: orderRepositoryMock,
  orderLifecycleService: orderLifecycleServiceMock,
  logger: mockLogger,
}));

const notificationServiceMock = vi.hoisted(() => ({
  sendFcmNotification: vi.fn().mockResolvedValue({ success: true }),
  storeDeliveryOtp: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../src/services/notificationService.js', () => notificationServiceMock);

const {
  default: deliveryRouter,
  calculateHaversineDistance,
  generatePodHash,
  isValidUrl,
} = await import('../../src/routes/deliveryRoutes.js');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/delivery', deliveryRouter);
  return app;
}

describe('deliveryRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = { id: 'usr-driver-101', role: 'driver' };
  });

  describe('Helper Functions', () => {
    it('calculates Haversine distance in meters accurately', () => {
      const lat1 = 28.6139;
      const lon1 = 77.2090;
      const lat2 = 28.6145;
      const lon2 = 77.2095;
      const distance = calculateHaversineDistance(lat1, lon1, lat2, lon2);
      expect(distance).toBeGreaterThan(50);
      expect(distance).toBeLessThan(150);
    });

    it('generates deterministic SHA-256 POD integrity hash', () => {
      const hash1 = generatePodHash('ORD-1', 'John Doe', 'https://sig.url/1.png', '2026-09-17T00:00:00Z');
      const hash2 = generatePodHash('ORD-1', 'John Doe', 'https://sig.url/1.png', '2026-09-17T00:00:00Z');
      const hash3 = generatePodHash('ORD-2', 'John Doe', 'https://sig.url/1.png', '2026-09-17T00:00:00Z');

      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
      expect(hash1).toBe(hash2);
      expect(hash1).not.toBe(hash3);
    });

    it('validates HTTP/HTTPS URLs', () => {
      expect(isValidUrl('https://s3.aws.com/pod/sig.png')).toBe(true);
      expect(isValidUrl('http://storage.internal/photo.jpg')).toBe(true);
      expect(isValidUrl('ftp://insecure/file')).toBe(false);
      expect(isValidUrl('not-a-url')).toBe(false);
      expect(isValidUrl(null)).toBe(false);
    });
  });

  describe('POST /api/delivery/:id/confirm-otp', () => {
    const validOrder = {
      data: {
        id: 'ORD-9021',
        driver_id: 'usr-driver-101',
        total_amount: 500000,
        destination_latitude: 28.6139,
        destination_longitude: 77.2090,
      },
    };

    it('successfully confirms delivery with OTP within geofence without runtime ReferenceError', async () => {
      orderRepositoryMock.findOrderByAnyId.mockResolvedValue(validOrder);
      orderLifecycleServiceMock.verifyDeliveryFn.mockResolvedValue({ escrowUpdateFailed: false });

      const res = await request(makeApp())
        .post('/api/delivery/ORD-9021/confirm-otp')
        .send({
          otp: '1234',
          latitude: 28.6140,
          longitude: 77.2091, // Within ~20m of destination
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.payment_released).toBe(true);
      expect(res.body.isGeofenced).toBe(true);
      expect(res.body.distanceToDestinationMeters).toBeLessThan(100);
      expect(orderLifecycleServiceMock.verifyDeliveryFn).toHaveBeenCalledWith('ORD-9021', 'usr-driver-101', '1234');
    });

    it('returns isGeofenced false when driver is outside 500m radius', async () => {
      orderRepositoryMock.findOrderByAnyId.mockResolvedValue(validOrder);
      orderLifecycleServiceMock.verifyDeliveryFn.mockResolvedValue({ escrowUpdateFailed: false });

      const res = await request(makeApp())
        .post('/api/delivery/ORD-9021/confirm-otp')
        .send({
          otp: '1234',
          latitude: 28.6500, // ~4 km away
          longitude: 77.2500,
        });

      expect(res.status).toBe(200);
      expect(res.body.isGeofenced).toBe(false);
      expect(res.body.distanceToDestinationMeters).toBeGreaterThan(500);
    });

    it('allows admin to confirm delivery for any order', async () => {
      mockUser = { id: 'usr-admin-1', role: 'admin' };
      orderRepositoryMock.findOrderByAnyId.mockResolvedValue(validOrder);
      orderLifecycleServiceMock.verifyDeliveryFn.mockResolvedValue({ escrowUpdateFailed: false });

      const res = await request(makeApp())
        .post('/api/delivery/ORD-9021/confirm-otp')
        .send({ otp: '1234' });

      expect(res.status).toBe(200);
    });

    it('denies unassigned driver with 403 Forbidden', async () => {
      mockUser = { id: 'usr-other-driver', role: 'driver' };
      orderRepositoryMock.findOrderByAnyId.mockResolvedValue(validOrder);

      const res = await request(makeApp())
        .post('/api/delivery/ORD-9021/confirm-otp')
        .send({ otp: '1234' });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/Access Denied/i);
    });

    it('returns 404 when order is not found', async () => {
      orderRepositoryMock.findOrderByAnyId.mockResolvedValue(null);

      const res = await request(makeApp())
        .post('/api/delivery/ORD-NONE/confirm-otp')
        .send({ otp: '1234' });

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/Order not found/i);
    });

    it('returns 400 when OTP is missing', async () => {
      orderRepositoryMock.findOrderByAnyId.mockResolvedValue(validOrder);

      const res = await request(makeApp())
        .post('/api/delivery/ORD-9021/confirm-otp')
        .send({});

      expect(res.status).toBe(400);
    });

    it('returns 202 when escrow payment requires reconciliation', async () => {
      orderRepositoryMock.findOrderByAnyId.mockResolvedValue(validOrder);
      orderLifecycleServiceMock.verifyDeliveryFn.mockResolvedValue({ escrowUpdateFailed: true });

      const res = await request(makeApp())
        .post('/api/delivery/ORD-9021/confirm-otp')
        .send({ otp: '1234' });

      expect(res.status).toBe(202);
      expect(res.body.message).toMatch(/requires reconciliation/i);
    });
  });

  describe('POST /api/delivery/:id/pod', () => {
    const validOrder = {
      data: {
        id: 'ORD-9021',
        driver_id: 'usr-driver-101',
      },
    };

    const validPodPayload = {
      receiver_name: 'Jane Smith',
      signature_url: 'https://storage.truxify.com/signatures/ord-9021.png',
      cargo_photo_url: 'https://storage.truxify.com/photos/cargo-9021.jpg',
      notes: 'Delivered to dock 3 in good condition',
      latitude: 28.6139,
      longitude: 77.2090,
    };

    it('successfully uploads Proof of Delivery (ePOD) with tamper-evident SHA-256 hash', async () => {
      orderRepositoryMock.findOrderByAnyId.mockResolvedValue(validOrder);
      orderRepositoryMock.updateOrderPod.mockResolvedValue(true);

      const res = await request(makeApp())
        .post('/api/delivery/ORD-9021/pod')
        .send(validPodPayload);

      expect(res.status).toBe(201);
      expect(res.body.message).toMatch(/Proof of Delivery.*submitted successfully/i);
      expect(res.body.pod.receiverName).toBe('Jane Smith');
      expect(res.body.pod.podHash).toMatch(/^[a-f0-9]{64}$/);
      expect(res.body.pod.submittedBy).toBe('usr-driver-101');
    });

    it('rejects invalid signature_url with 400', async () => {
      orderRepositoryMock.findOrderByAnyId.mockResolvedValue(validOrder);

      const res = await request(makeApp())
        .post('/api/delivery/ORD-9021/pod')
        .send({
          ...validPodPayload,
          signature_url: 'insecure-file-link',
        });

      expect(res.status).toBe(400);
    });

    it('denies unauthorized user from submitting POD with 403', async () => {
      mockUser = { id: 'usr-intruder', role: 'driver' };
      orderRepositoryMock.findOrderByAnyId.mockResolvedValue(validOrder);

      const res = await request(makeApp())
        .post('/api/delivery/ORD-9021/pod')
        .send(validPodPayload);

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/Access Denied/i);
    });
  });

  describe('GET /api/delivery/:id/status', () => {
    it('returns delivery status for assigned driver', async () => {
      const validOrder = {
        data: {
          id: 'ORD-9021',
          driver_id: 'usr-driver-101',
          status: 'DELIVERED',
          pod: { receiverName: 'Jane Smith' },
        },
      };
      orderRepositoryMock.findOrderByAnyId.mockResolvedValue(validOrder);

      const res = await request(makeApp())
        .get('/api/delivery/ORD-9021/status');

      expect(res.status).toBe(200);
      expect(res.body.orderId).toBe('ORD-9021');
      expect(res.body.status).toBe('DELIVERED');
      expect(res.body.deliveryConfirmed).toBe(true);
      expect(res.body.pod).toEqual({ receiverName: 'Jane Smith' });
    });

    it('returns 403 for unauthorized caller', async () => {
      const validOrder = {
        data: {
          id: 'ORD-9021',
          driver_id: 'usr-other-driver',
          shipper_id: 'usr-other-shipper',
        },
      };
      orderRepositoryMock.findOrderByAnyId.mockResolvedValue(validOrder);

      const res = await request(makeApp())
        .get('/api/delivery/ORD-9021/status');

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/Access Denied/i);
    });
  });
});
