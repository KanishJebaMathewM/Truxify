import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import orderRoutes from '../../src/routes/orderRoutes.js';

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
  requirePolicy: () => (req, res, next) => next(),
}));

import { orderValidationService, orderLifecycleService } from '../../src/core/container.js';

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  req.user = { id: 'driver-1' };
  next();
});
app.use('/api/orders', orderRoutes);

describe('POST /api/orders/:id/geofence-confirm validation', () => {
  beforeEach(() => {
    orderValidationService.findOrderByIdOrDisplayId.mockReset();
    orderLifecycleService.deliveryVerification.geofenceAutoConfirm.mockReset();
  });

  it('should accept valid lat, lng and geofence_radius_m', async () => {
    orderValidationService.findOrderByIdOrDisplayId.mockResolvedValue({ id: '123', driver_id: 'driver-1', customer_id: 'c1' });
    orderLifecycleService.deliveryVerification.geofenceAutoConfirm.mockResolvedValue({ success: true });

    const res = await request(app)
      .post('/api/orders/123/geofence-confirm')
      .send({ driver_lat: 12.9716, driver_lng: 77.5946, geofence_radius_m: 100 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(orderLifecycleService.deliveryVerification.geofenceAutoConfirm).toHaveBeenCalledWith({
      orderId: '123',
      driverId: 'driver-1',
      driverLat: 12.9716,
      driverLng: 77.5946,
      geofenceRadiusM: 100,
    });
  });

  it('should reject NaN geofence_radius_m with 400', async () => {
    const res = await request(app)
      .post('/api/orders/123/geofence-confirm')
      .send({ driver_lat: 12.9716, driver_lng: 77.5946, geofence_radius_m: 'invalid' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('should reject non-positive geofence_radius_m with 400', async () => {
    const res = await request(app)
      .post('/api/orders/123/geofence-confirm')
      .send({ driver_lat: 12.9716, driver_lng: 77.5946, geofence_radius_m: -50 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
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
  req.user = { id: 'driver-1' };
  next();
});
regressionApp.use('/api/orders', orderRoutes);

describe('POST /api/orders/:id/geofence-confirm (issue #12053 regression)', () => {
  beforeEach(() => {
    orderValidationService.findOrderByIdOrDisplayId.mockReset();
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
