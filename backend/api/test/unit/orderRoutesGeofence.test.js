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
}));

vi.mock('../../src/middleware/requirePolicy.js', () => ({
  requirePolicy: () => (req, res, next) => next(),
}));

vi.mock('../../src/config/db.js', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { id: '123', status: 'pending' }, error: null }),
        }),
      }),
    }),
  },
  mongoDb: {
    collection: () => ({
      findOne: async () => ({
        orderId: '123',
        location: { latitude: 12.9716, longitude: 77.5946 },
        timestamp: new Date().toISOString(),
      }),
    }),
  },
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
      orderId: '12
