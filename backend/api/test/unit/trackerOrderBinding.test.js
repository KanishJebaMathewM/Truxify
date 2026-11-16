/**
 * Which order a driver's location ping is bound to.
 *
 * A ping for an order that has ended (#10676), or one whose order lookup
 * failed (#11190), must not be recorded or broadcast against that order.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/config/db.js', () => ({
  get mongoDb() { return null; },
  get redisClient() { return null; },
  get firebaseAdmin() { return null; },
  get supabase() { return null; },
  get supabaseAdmin() { return null; },
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { handleLocationPing, closeWebSocketServer, __testing } = await import('../../src/sockets/tracker.js');

const DRIVER_ID = 'driver-1';

function makeWs() {
  return {
    driverId: DRIVER_ID,
    user: { id: DRIVER_ID, role: 'driver' },
    send: vi.fn(),
    close: vi.fn(),
    isAlive: true,
    readyState: 1,
    subscriptionTargets: new Set(),
    socketId: `socket-${Math.random()}`,
  };
}

function orderRow(status) {
  return { id: 'order-uuid-1', order_display_id: 'OD-1', driver_id: DRIVER_ID, status };
}

async function lastTelemetryRecord() {
  const records = await __testing.getTelemetryWriteBuffer().toArray();
  return records[records.length - 1];
}

describe('tracker: order binding for location pings', () => {
  beforeEach(async () => {
    __testing.clearConsecutiveDropCount();
    await __testing.clearTelemetryWriteBuffer();
  });

  afterEach(async () => {
    await closeWebSocketServer();
  });

  it('binds a ping to the driver\'s active order', async () => {
    __testing.setOrderRepository({
      findOrderByAnyId: vi.fn().mockResolvedValue({ data: orderRow('in_transit'), error: null }),
    });

    await handleLocationPing(makeWs(), { lat: 19.076, lng: 72.877, order_display_id: 'OD-1' });

    const record = await lastTelemetryRecord();
    expect(record.order_id).toBe('order-uuid-1');
    expect(record.order_display_id).toBe('OD-1');
  });

  it.each(['delivered', 'cancelled', 'payment_released'])(
    'does not bind a ping to an order that is already %s',
    async (status) => {
      __testing.setOrderRepository({
        findOrderByAnyId: vi.fn().mockResolvedValue({ data: orderRow(status), error: null }),
      });

      await handleLocationPing(makeWs(), { lat: 19.076, lng: 72.877, order_display_id: 'OD-1' });

      const record = await lastTelemetryRecord();
      expect(record.driver_id).toBe(DRIVER_ID);
      expect(record.order_id).toBeNull();
      expect(record.order_display_id).toBeNull();
    }
  );

  it('drops the client-supplied order id when the ownership lookup fails', async () => {
    __testing.setOrderRepository({
      findOrderByAnyId: vi.fn().mockRejectedValue(new Error('connection terminated')),
    });

    await handleLocationPing(makeWs(), { lat: 19.076, lng: 72.877, order_display_id: 'OD-SOMEONE-ELSE' });

    const record = await lastTelemetryRecord();
    expect(record.driver_id).toBe(DRIVER_ID);
    expect(record.order_id).toBeNull();
    expect(record.order_display_id).toBeNull();
  });
});
