import { describe, it, expect, vi } from 'vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// The geofence-confirm handler validates driver_lat/driver_lng/geofence_radius_m
// BEFORE touching the DB (NaN/positive-radius guards), then delegates the actual
// geofence check to the delivery verification service. Stub the container-bound
// services so the happy path is exercised without a live DB.
const findOrderByIdOrDisplayIdMock = vi.fn();
const assertDriverAssignmentMock = vi.fn();
const geofenceAutoConfirmMock = vi.fn();

vi.mock('../../src/core/container.js', async () => {
  const actual = await vi.importActual('../../src/core/container.js');
  const validationSvc = Object.create(actual.orderValidationService);
  validationSvc.findOrderByIdOrDisplayId = findOrderByIdOrDisplayIdMock;
  validationSvc.assertDriverAssignment = assertDriverAssignmentMock;
  const lifecycleSvc = Object.create(actual.orderLifecycleService);
  lifecycleSvc.deliveryVerification = { geofenceAutoConfirm: geofenceAutoConfirmMock };
  return {
    ...actual,
    orderValidationService: validationSvc,
    orderLifecycleService: lifecycleSvc,
  };
});

const DRIVER_HEADERS = {
  'x-user-id': '00000000-0000-0000-0000-000000000def',
  'x-user-role': 'driver',
  'x-user-name': 'Test Driver'
};

const orderRoutes = (await import('../../src/routes/orderRoutes.js')).default;

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
app.use('/api/orders', orderRoutes);

describe('POST /api/orders/:id/geofence-confirm validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findOrderByIdOrDisplayIdMock.mockReset();
    assertDriverAssignmentMock.mockReset();
    geofenceAutoConfirmMock.mockReset();
  });

  it('should accept valid lat, lng and geofence_radius_m', async () => {
    findOrderByIdOrDisplayIdMock.mockResolvedValue({
      id: '123',
      driver_id: DRIVER_HEADERS['x-user-id'],
      customer_id: 'customer-1'
    });
    geofenceAutoConfirmMock.mockResolvedValue({ success: true });
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
      .post('/api/orders/123/geofence-confirm')
      .set(DRIVER_HEADERS)
      .send({ driver_lat: 12.9716, driver_lng: 77.5946, geofence_radius_m: 100 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(geofenceAutoConfirmMock).toHaveBeenCalledWith(
      expect.objectContaining({ geofenceRadiusM: 100 })
    );
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
      .set(DRIVER_HEADERS)
      .send({ driver_lat: 12.9716, driver_lng: 77.5946, geofence_radius_m: 'invalid' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(geofenceAutoConfirmMock).not.toHaveBeenCalled();
  });

  it('should reject non-positive geofence_radius_m with 400', async () => {
    const res = await request(app)
      .post('/api/orders/123/geofence-confirm')
      .set(DRIVER_HEADERS)
      .send({ driver_lat: 12.9716, driver_lng: 77.5946, geofence_radius_m: -50 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(geofenceAutoConfirmMock).not.toHaveBeenCalled();
  });
});
