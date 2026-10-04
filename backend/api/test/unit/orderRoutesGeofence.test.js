import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import orderRoutes from '../../src/routes/orderRoutes.js';
import { DomainError } from '../../src/services/order/domainError.js';

vi.mock('../../src/core/container.js', () => ({
  orderRepository: {},
  orderValidationService: {
    findOrderByIdOrDisplayId: vi.fn(),
    assertOrderFound: vi.fn(),
    assertDriverAssignment: vi.fn(),
  },
  orderTimelineService: {},
  orderMilestoneService: {},
  orderLifecycleService: {
    deliveryVerification: {
      geofenceAutoConfirm: vi.fn(),
    },
  },
  deliveryVerificationService: {},
  buildDepositTx: vi.fn(),
  recordDepositTx: vi.fn(),
  submitEscrowRefund: vi.fn(),
  confirmEscrowRefund: vi.fn(),
}));

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, res, next) => next(),
  requireRole: () => (req, res, next) => next(),
}));

vi.mock('../../src/middleware/requirePolicy.js', () => ({
  requirePolicy: () => (req, res, next) => next(),
}));

vi.mock('../../src/controllers/orderController.js', () => ({
  createOrder: vi.fn(),
  getActiveOrders: vi.fn(),
  getLoadOffers: vi.fn(),
  getOrderHistory: vi.fn(),
  getOrderDetails: vi.fn(),
  verifyDeliveryController: vi.fn(),
  resendOtp: vi.fn(),
  changeDrop: vi.fn(),
  cancelOrder: vi.fn(),
  predictRideDemand: vi.fn(),
}));

import { orderValidationService, orderLifecycleService } from '../../src/core/container.js';

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  req.user = { id: 'driver-1', role: 'driver' };
  next();
});
app.use('/api/orders', orderRoutes);

describe('POST /api/orders/:id/geofence-confirm validation', () => {
  beforeEach(() => {
    orderValidationService.findOrderByIdOrDisplayId.mockReset();
    orderValidationService.assertOrderFound.mockReset();
    orderValidationService.assertDriverAssignment.mockReset();
    orderLifecycleService.deliveryVerification.geofenceAutoConfirm.mockReset();
  });

  it('allows a legitimate driver to confirm delivery using server-side telemetry without providing client coordinates', async () => {
    orderValidationService.findOrderByIdOrDisplayId.mockResolvedValue({ id: '123', driver_id: 'driver-1', customer_id: 'c1' });
    orderLifecycleService.deliveryVerification.geofenceAutoConfirm.mockResolvedValue({ autoConfirmed: true, message: 'Driver confirmed via server telemetry' });

    // Request with empty body - no client GPS coordinates supplied
    const res = await request(app)
      .post('/api/orders/123/geofence-confirm')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.autoConfirmed).toBe(true);
    expect(orderLifecycleService.deliveryVerification.geofenceAutoConfirm).toHaveBeenCalledWith({
      orderId: '123',
      driverId: 'driver-1',
      driverLat: undefined,
      driverLng: undefined,
      geofenceRadiusM: 500,
    });
  });

  it('does not trust arbitrary client GPS coordinates to pass if server telemetry rejects', async () => {
    orderValidationService.findOrderByIdOrDisplayId.mockResolvedValue({ id: '123', driver_id: 'driver-1', customer_id: 'c1' });
    // Service rejects because driver's actual server telemetry is outside geofence
    orderLifecycleService.deliveryVerification.geofenceAutoConfirm.mockRejectedValue(
      new DomainError(409, { error: 'Driver is 5.20km from the drop-off location. Must be within 500m to confirm delivery.' })
    );

    // Client attempts to spoof GPS coordinates close to drop location
    const res = await request(app)
      .post('/api/orders/123/geofence-confirm')
      .send({ driver_lat: 12.9716, driver_lng: 77.5946 });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('5.20km from the drop-off location');
  });

  it('rejects with 409 when the driver is outside the geofence according to server telemetry', async () => {
    orderValidationService.findOrderByIdOrDisplayId.mockResolvedValue({ id: '123', driver_id: 'driver-1', customer_id: 'c1' });
    orderLifecycleService.deliveryVerification.geofenceAutoConfirm.mockRejectedValue(
      new DomainError(409, { error: 'Driver is 1.50km from the drop-off location. Must be within 500m to confirm delivery.' })
    );

    const res = await request(app)
      .post('/api/orders/123/geofence-confirm')
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('1.50km');
  });

  it('handles missing or unavailable trusted server telemetry safely with 409', async () => {
    orderValidationService.findOrderByIdOrDisplayId.mockResolvedValue({ id: '123', driver_id: 'driver-1', customer_id: 'c1' });
    orderLifecycleService.deliveryVerification.geofenceAutoConfirm.mockRejectedValue(
      new DomainError(409, { error: 'Location is not available for this driver on this order.' })
    );

    const res = await request(app)
      .post('/api/orders/123/geofence-confirm')
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Location is not available for this driver on this order.');
  });

  it('handles telemetry database unavailability safely with 503', async () => {
    orderValidationService.findOrderByIdOrDisplayId.mockResolvedValue({ id: '123', driver_id: 'driver-1', customer_id: 'c1' });
    orderLifecycleService.deliveryVerification.geofenceAutoConfirm.mockRejectedValue(
      new DomainError(503, { error: 'Telemetry database not available.', retryable: true })
    );

    const res = await request(app)
      .post('/api/orders/123/geofence-confirm')
      .send({});

    expect(res.status).toBe(503);
    expect(res.body.error).toBe('Telemetry database not available.');
  });

  it('preserves authorization: rejects when driver is not assigned to order', async () => {
    orderValidationService.findOrderByIdOrDisplayId.mockResolvedValue({ id: '123', driver_id: 'different-driver', customer_id: 'c1' });
    orderValidationService.assertDriverAssignment.mockImplementation(() => {
      throw new DomainError(403, { error: 'Access Denied: You are not assigned to this order.' });
    });

    const res = await request(app)
      .post('/api/orders/123/geofence-confirm')
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Access Denied');
  });

  it('preserves validation: rejects when order does not exist', async () => {
    orderValidationService.findOrderByIdOrDisplayId.mockResolvedValue(null);
    orderValidationService.assertOrderFound.mockImplementation(() => {
      throw new DomainError(404, { error: 'Order not found.' });
    });

    const res = await request(app)
      .post('/api/orders/999/geofence-confirm')
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Order not found.');
  });

  it('rejects invalid driver_lat and driver_lng when provided as non-numbers', async () => {
    const res = await request(app)
      .post('/api/orders/123/geofence-confirm')
      .send({ driver_lat: 'invalid', driver_lng: 77.5946 });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('must be valid numbers');
  });

  it('rejects when only one coordinate is provided', async () => {
    const res = await request(app)
      .post('/api/orders/123/geofence-confirm')
      .send({ driver_lat: 12.9716 });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('must both be provided');
  });

  it('accepts valid claimed coordinates and optional geofence_radius_m', async () => {
    orderValidationService.findOrderByIdOrDisplayId.mockResolvedValue({ id: '123', driver_id: 'driver-1', customer_id: 'c1' });
    orderLifecycleService.deliveryVerification.geofenceAutoConfirm.mockResolvedValue({ autoConfirmed: true });

    const res = await request(app)
      .post('/api/orders/123/geofence-confirm')
      .send({ driver_lat: 12.9716, driver_lng: 77.5946, geofence_radius_m: 250 });

    expect(res.status).toBe(200);
    expect(res.body.autoConfirmed).toBe(true);
    expect(orderLifecycleService.deliveryVerification.geofenceAutoConfirm).toHaveBeenCalledWith({
      orderId: '123',
      driverId: 'driver-1',
      driverLat: 12.9716,
      driverLng: 77.5946,
      geofenceRadiusM: 250,
    });
  });

  it('should reject NaN geofence_radius_m with 400', async () => {
    const res = await request(app)
      .post('/api/orders/123/geofence-confirm')
      .send({ geofence_radius_m: 'invalid' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('should reject non-positive geofence_radius_m with 400', async () => {
    const res = await request(app)
      .post('/api/orders/123/geofence-confirm')
      .send({ geofence_radius_m: -50 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('should reject an unbounded geofence radius (> 500m) with 400', async () => {
    const res = await request(app)
      .post('/api/orders/123/geofence-confirm')
      .send({ geofence_radius_m: 501 });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('500');
  });
});

// Regression tests for issue #12053: the geofence-confirm route must be
// reachable at its real mounted path (/api/orders/:id/geofence-confirm, since
// orderRoutes is mounted under /api/orders in index.js) and must read the id
// from req.params (not an undeclared `id`, which previously threw a
// ReferenceError). Mounted the same way the production app does.
const regressionApp = express();
regressionApp.use(express.json());
regressionApp.use((req, res, next) => {
  req.user = { id: 'driver-1', role: 'driver' };
  next();
});
regressionApp.use('/api/orders', orderRoutes);

describe('POST /api/orders/:id/geofence-confirm (issue #12053 regression)', () => {
  beforeEach(() => {
    orderValidationService.findOrderByIdOrDisplayId.mockReset();
    orderValidationService.assertOrderFound.mockReset();
    orderValidationService.assertDriverAssignment.mockReset();
    orderLifecycleService.deliveryVerification.geofenceAutoConfirm.mockReset();
  });

  it('reaches the handler at the correct mounted path and uses req.params.id (no ReferenceError)', async () => {
    orderValidationService.findOrderByIdOrDisplayId.mockResolvedValue({ id: '123', driver_id: 'driver-1', customer_id: 'c1' });
    orderLifecycleService.deliveryVerification.geofenceAutoConfirm.mockResolvedValue({ success: true });

    const res = await request(regressionApp)
      .post('/api/orders/123/geofence-confirm')
      .send({ driver_lat: 12.9716, driver_lng: 77.5946, geofence_radius_m: 100 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(orderLifecycleService.deliveryVerification.geofenceAutoConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: '123', driverId: 'driver-1' })
    );
  });

  it('returns 400 (not 500) for an empty order id via req.params.id', async () => {
    const res = await request(regressionApp)
      .post(`/api/orders/${encodeURIComponent('   ')}/geofence-confirm`)
      .send({ driver_lat: 12.9716, driver_lng: 77.5946 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });
});
