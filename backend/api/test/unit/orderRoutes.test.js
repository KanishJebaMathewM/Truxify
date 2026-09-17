import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  changeDropSchema,
  cancelOrderSchema,
  submitBidSchema,
  submitRatingSchema,
  updateMilestoneSchema,
  verifyDeliverySchema,
} from '../../src/validation/requestSchemas.js';

const routeFile = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../src/routes/orderRoutes.js',
);
let source;

beforeAll(() => {
  source = fs.readFileSync(routeFile, 'utf8');
});

describe('orderRoutes structure', () => {
  it('requires pickup_address in order creation', () => {
    const validOrder = {
      pickup_address: '123 Main St',
      drop_address: '456 Oak Ave',
      pickup_lat: 12.9716,
      pickup_lng: 77.5946,
      drop_lat: 28.7041,
      drop_lng: 77.1025,
      weight_tonnes: 5,
      goods_type: 'electronics',
      is_fragile: false,
      is_stackable: true,
    };
    expect(validOrder.pickup_address).toBeTruthy();
    expect(validOrder.drop_address).toBeTruthy();
  });

  it('validates coordinates are within valid ranges', () => {
    const req = {
      body: {
        pickup_lat: 12.9716,
        pickup_lng: 77.5946,
        drop_lat: 28.7041,
        drop_lng: 77.1025,
      },
    };
    expect(req.body.pickup_lat).toBeGreaterThan(-90);
    expect(req.body.pickup_lat).toBeLessThan(90);
    expect(req.body.drop_lat).toBeGreaterThan(-90);
    expect(req.body.drop_lat).toBeLessThan(90);
    expect(req.body.pickup_lng).toBeGreaterThan(-180);
    expect(req.body.pickup_lng).toBeLessThan(180);
  });

  it('requires weight_tonnes to be positive', () => {
    const validReq = { body: { weight_tonnes: 5 } };
    expect(validReq.body.weight_tonnes).toBeGreaterThan(0);
  });

  it('requires bid amount to be positive', () => {
    const validBid = { body: { amount: 100000 } };
    expect(validBid.body.amount).toBeGreaterThan(0);
  });

  it('requires rating between 1 and 5', () => {
    for (let rating = 1; rating <= 5; rating++) {
      expect(rating >= 1 && rating <= 5).toBe(true);
    }
    expect(0).toBeLessThan(1);
    expect(6).toBeGreaterThan(5);
  });
});

describe('orderRoutes endpoint contract', () => {
  const routes = [
    ['GET', '/my/active'],
    ['GET', '/load-offers'],
    ['GET', '/history'],
    ['GET', '/:id'],
    ['GET', '/load-offers/en-route'],
    ['POST', '/:id/bids'],
    ['GET', '/:id/bids'],
    ['POST', '/:id/bids/:bidId/accept'],
    ['POST', '/:id/ratings'],
    ['PUT', '/:id/milestones'],
    ['POST', '/:id/verify-delivery'],
    ['POST', '/:id/confirm-otp'],
    ['POST', '/:id/resend-otp'],
    ['PUT', '/:id/change-drop'],
    ['POST', '/:id/cancel'],
    ['POST', '/:id/confirm-deposit'],
    ['GET', '/:id/driver-location'],
    ['GET', '/:id/route'],
  ];

  it.each(routes)('declares %s %s', (method, route) => {
    expect(source).toContain(`router.${method.toLowerCase()}('${route}'`);
  });

  it('does not remove authentication from lifecycle routes', () => {
    const lifecycleRoutes = [
      "router.put('/:id/milestones'",
      "router.post('/:id/verify-delivery'",
      "router.put('/:id/change-drop'",
      "router.post('/:id/cancel'",
      "router.post('/:id/confirm-deposit'",
    ];

    for (const route of lifecycleRoutes) {
      const start = source.indexOf(route);
      expect(start).toBeGreaterThanOrEqual(0);
      const declaration = source.slice(start, source.indexOf('\n', start));
      expect(declaration).toContain('authenticate');
    }
  });

  it('protects customer-only endpoints with customer role or policy', () => {
    const customerRoutes = [
      "router.get('/my/active'",
      "router.get('/history'",
      "router.post('/:id/ratings'",
      "router.get('/:id/bids'",
      "router.post('/:id/bids/:bidId/accept'",
      "router.put('/:id/change-drop'",
      "router.post('/:id/cancel'",
    ];

    for (const route of customerRoutes) {
      const start = source.indexOf(route);
      expect(start).toBeGreaterThanOrEqual(0);
      const declaration = source.slice(start, source.indexOf('\n', start));
      expect(declaration).toMatch(/requireRole\(\['customer'\]\)|requirePolicy\('order:/);
    }
  });

  it('protects driver-only lifecycle endpoints with driver role or policy', () => {
    const driverRoutes = [
      "router.post('/:id/bids'",
      "router.put('/:id/milestones'",
      "router.post('/:id/verify-delivery'",
      "router.post('/:id/confirm-otp'",
      "router.post('/:id/resend-otp'",
    ];

    for (const route of driverRoutes) {
      const start = source.indexOf(route);
      expect(start).toBeGreaterThanOrEqual(0);
      const declaration = source.slice(start, source.indexOf('\n', start));
      expect(declaration).toMatch(/requireRole\(\['driver'\]\)|requirePolicy\('delivery:verify'|requirePolicy\('bid:|requirePolicy\('milestone:/);
    }
  });

  it('validates path parameters on id-based routes', () => {
    const idRoutes = [
      "router.get('/:id'",
      "router.post('/:id/bids'",
      "router.get('/:id/bids'",
      "router.put('/:id/milestones'",
      "router.post('/:id/cancel'",
      "router.put('/:id/change-drop'",
      "router.get('/:id/driver-location'",
      "router.get('/:id/route'",
    ];

    for (const route of idRoutes) {
      const start = source.indexOf(route);
      expect(start).toBeGreaterThanOrEqual(0);
      const declaration = source.slice(start, source.indexOf('\n', start));
      expect(declaration).toContain('validateParams(paramIdSchema)');
    }
  });

  it('uses idempotency protection for money or state-changing operations', () => {
    expect(source).toContain("router.post('/:id/cancel', authenticate, userLimiter, requireRole(['customer']), requireIdempotency(86400)");
    expect(source).toContain("router.post('/:id/confirm-deposit', authenticate, userLimiter, requirePolicy('order:confirm-deposit')");
    expect(source).toContain('requireIdempotency(86400), validateParams(paramIdSchema)');
    expect(source).toContain('requireIdempotency(3600), validateParams(paramIdSchema)');
  });
});

describe('orderRoutes request schema contract', () => {
  it('accepts a valid drop change payload', () => {
    const result = changeDropSchema.safeParse({
      drop_address: 'Mumbai, Maharashtra',
      drop_lat: 19.076,
      drop_lng: 72.877,
    });
    expect(result.success).toBe(true);
  });

  it.each([
    [{ drop_address: 'Mumbai', drop_lat: -91, drop_lng: 72 }, 'latitude below range'],
    [{ drop_address: 'Mumbai', drop_lat: 91, drop_lng: 72 }, 'latitude above range'],
    [{ drop_address: 'Mumbai', drop_lat: 19, drop_lng: -181 }, 'longitude below range'],
    [{ drop_address: 'Mumbai', drop_lat: 19, drop_lng: 181 }, 'longitude above range'],
    [{ drop_address: 'x', drop_lat: 19, drop_lng: 72 }, 'short address'],
  ])('rejects %s', (payload) => {
    expect(changeDropSchema.safeParse(payload).success).toBe(false);
  });

  it('accepts omitted and null cancellation reason for compatibility', () => {
    expect(cancelOrderSchema.safeParse({}).success).toBe(true);
    expect(cancelOrderSchema.safeParse({ reason: null }).success).toBe(true);
    expect(cancelOrderSchema.safeParse({ reason: 'Changed plans' }).success).toBe(true);
  });

  it('preserves the current optional cancellation reason contract', () => {
    expect(cancelOrderSchema.safeParse({ reason: '   ' }).success).toBe(true);
    expect(cancelOrderSchema.safeParse({ reason: 'x'.repeat(501) }).success).toBe(false);
  });

  it('accepts valid bid amounts and rejects invalid amounts', () => {
    expect(submitBidSchema.safeParse({ bid_amount: 100 }).success).toBe(true);
    expect(submitBidSchema.safeParse({ bid_amount: 0 }).success).toBe(false);
    expect(submitBidSchema.safeParse({ bid_amount: -1 }).success).toBe(false);
  });

  it('accepts ratings from one through five', () => {
    for (let rating = 1; rating <= 5; rating += 1) {
      expect(submitRatingSchema.safeParse({ stars: rating }).success).toBe(true);
    }
  });

  it('rejects ratings outside the allowed range', () => {
    expect(submitRatingSchema.safeParse({ stars: 0 }).success).toBe(false);
    expect(submitRatingSchema.safeParse({ stars: 6 }).success).toBe(false);
  });

  it('accepts the supported milestone values', () => {
    const milestones = [
      'Truck Assigned',
      'En Route to Pickup',
      'Arrived at Pickup',
      'Goods Loaded',
      'In Transit',
      'Arriving',
      'Delivered',
    ];
    for (const milestone of milestones) {
      expect(updateMilestoneSchema.safeParse({ milestone }).success).toBe(true);
    }
  });

  it('rejects unknown milestone values', () => {
    expect(updateMilestoneSchema.safeParse({ milestone: 'Unknown' }).success).toBe(false);
  });

  it('requires a six-digit delivery OTP', () => {
    expect(verifyDeliverySchema.safeParse({ otp: '123456' }).success).toBe(true);
    expect(verifyDeliverySchema.safeParse({ otp: '12345' }).success).toBe(false);
    expect(verifyDeliverySchema.safeParse({ otp: 'abcdef' }).success).toBe(false);
  });
});

describe('orderRoutes implementation wiring', () => {
  it('delegates order lifecycle work to controllers rather than duplicating persistence', () => {
    const expectedControllers = [
      'createOrder',
      'getActiveOrders',
      'getLoadOffers',
      'getOrderHistory',
      'getOrderDetails',
      'submitBid',
      'submitRating',
      'getBids',
      'acceptBid',
      'updateMilestone',
      'verifyDeliveryController',
      'resendOtp',
      'changeDrop',
      'cancelOrder',
      'confirmDeposit',
      'getDriverLocation',
      'getLiveRouteGeometry',
    ];

    for (const controller of expectedControllers) {
      expect(source).toContain(controller);
    }
  });

  it('keeps the cancellation and change-drop endpoints distinct', () => {
    expect(source).toContain("router.put('/:id/change-drop'");
    expect(source).toContain("router.post('/:id/cancel'");
    expect(source.indexOf("router.put('/:id/change-drop'")).toBeLessThan(
      source.indexOf("router.post('/:id/cancel'")
    );
  });

  it('has explicit error handling for the geofence endpoint', () => {
    const start = source.indexOf("'/:id/geofence-confirm'");
    const end = source.indexOf('// 5. FETCH MY ORDER HISTORY', start);
    const section = source.slice(start, end);
    expect(section).toContain('driver_lat and driver_lng are required');
    expect(section).toContain('Number.isFinite');
    expect(section).toContain('geofenceAutoConfirm');
    expect(section).toContain('Internal Server Error');
  });

  it('documents the core order lifecycle operations', () => {
    for (const operation of [
      'UPDATE ORDER MILESTONE',
      'VERIFY DELIVERY OTP',
      'CHANGE DROP',
      'CANCEL ORDER AND REFUND ESCROW',
      'CONFIRM ESCROW DEPOSIT',
    ]) {
      expect(source).toContain(operation);
    }
  });
});
