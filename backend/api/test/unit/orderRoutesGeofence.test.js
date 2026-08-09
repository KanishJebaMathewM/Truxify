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

import { orderValidationService, orderLifecycleService } from '../../src/core/container.js';

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  req.user = { id: 'driver-1' };
  next();
});
app.use(orderRoutes);

describe('POST /api/deliveries/:id/geofence-confirm validation', () => {
  beforeEach(() => {
    orderValidationService.findOrderByIdOrDisplayId.mockReset();
    orderLifecycleService.deliveryVerification.geofenceAutoConfirm.mockReset();
  });

  it('should accept valid lat, lng and geofence_radius_m', async () => {
    orderValidationService.findOrderByIdOrDisplayId.mockResolvedValue({ id: '123', driver_id: 'driver-1', customer_id: 'c1' });
    orderLifecycleService.deliveryVerification.geofenceAutoConfirm.mockResolvedValue({ success: true });

    const res = await request(app)
      .post('/api/deliveries/123/geofence-confirm')
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
      .post('/api/deliveries/123/geofence-confirm')
      .send({ driver_lat: 12.9716, driver_lng: 77.5946, geofence_radius_m: 'invalid' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('should reject non-positive geofence_radius_m with 400', async () => {
    const res = await request(app)
      .post('/api/deliveries/123/geofence-confirm')
      .send({ driver_lat: 12.9716, driver_lng: 77.5946, geofence_radius_m: -50 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });
});
