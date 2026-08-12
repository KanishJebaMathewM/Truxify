import { describe, it, expect, vi } from 'vitest';

const db = vi.hoisted(() => ({
  sentinelSupabase: { name: 'sentinel-supabase-client' },
}));

vi.mock('../src/config/db.js', () => ({
  get supabase() { return db.sentinelSupabase; },
  get supabaseAdmin() { return null; },
  get redisClient() { return null; },
  get mongoDb() { return null; },
  get firebaseAdmin() { return null; },
}));

vi.mock('../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../src/core/performanceMetrics.js', () => ({
  measureExecution: (name, fn) => fn(),
}));

vi.mock('../src/services/escrow.js', () => ({
  escrowRelease: vi.fn(),
}));

// Issue #4513 regression: module load must not throw a ReferenceError on an
// undefined `supabase` binding, and the default OrderTimelineService must be
// constructed with the configured Supabase client.
const { DeliveryVerificationService } = await import(
  '../src/services/order/deliveryVerificationService.js'
);

describe('DeliveryVerificationService supabase wiring (issue #4513)', () => {
  it('module loads without ReferenceError (supabase is imported)', () => {
    expect(typeof DeliveryVerificationService).toBe('function');
  });

  it('constructs the default OrderTimelineService with the configured supabase client', () => {
    const svc = new DeliveryVerificationService(null);
    expect(svc.orderTimelineService).toBeDefined();
    expect(svc.orderTimelineService.orderRepository).toBe(db.sentinelSupabase);
  });

  it('returns a sensible domain error when no order exists (service is functional)', async () => {
    const svc = new DeliveryVerificationService({
      findOrderById: () =>
        Promise.resolve({ data: null, error: null }),
    });
    await expect(
      svc.validateDeliveryOtp({ orderId: 'missing', driverId: 'd-1', otp: 'x' }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
