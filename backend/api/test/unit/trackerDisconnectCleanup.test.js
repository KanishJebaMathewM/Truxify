/**
 * @fileoverview Regression tests for the tracker disconnect cleanup restored
 * in the sockets merge-repair (issue #17335). `removeClientFromAllSubscriptions`
 * had been dropped by a bad merge while the ws close/error handlers still
 * called it, so every client disconnect threw a TypeError and leaked
 * subscriptions, Supabase Realtime channels and Redis subscription keys.
 *
 * Heavy tracker.js imports are mocked so this suite does not depend on the
 * wider (still repairing) source tree parsing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const redisMock = { expire: vi.fn(), srem: vi.fn(), sadd: vi.fn(), persist: vi.fn(), smembers: vi.fn() };

vi.mock('../../src/config/db.js', () => ({
  mongoDb: null,
  redisClient: redisMock,
  firebaseAdmin: null,
  supabase: null,
  supabaseAdmin: null,
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/sockets/locationEventBus.js', () => ({
  createLocationEventBus: vi.fn(() => ({
    getInstanceId: () => 'test-instance',
    subscribe: vi.fn(),
    publish: vi.fn(),
    recordDelivery: vi.fn(),
    getMetrics: () => ({}),
  })),
}));

vi.mock('../../src/sockets/telemetryBuffer.js', () => ({
  default: {
    _test: { flush: vi.fn() },
    enqueue: vi.fn(),
    start: vi.fn(),
    shutdown: vi.fn(),
  },
}));

vi.mock('../../src/models/GpsLog.js', () => ({ default: {} }));

vi.mock('../../src/services/order/etaService.js', () => ({
  scheduleEtaRecalculationOnLocationUpdate: vi.fn(),
}));

vi.mock('../../src/services/order/deliveryDelayService.js', () => ({
  default: vi.fn(),
}));

vi.mock('../../src/sockets/adaptivePoller.js', () => ({
  calculateAdaptiveInterval: vi.fn(() => 5000),
  getQueueDepth: vi.fn(() => 0),
}));

const { __testing } = await import('../../src/sockets/tracker.js');

describe('tracker disconnect cleanup (#17335)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __testing.resetTrackingSubscriptions();
  });

  it('exposes removeClientFromAllSubscriptions on the testing seam', () => {
    expect(typeof __testing.removeClientFromAllSubscriptions).toBe('function');
  });

  it('removes the socket from every subscription key and deletes emptied keys', async () => {
    const ws = { user: { id: 'user-1' }, socketId: 'socket-1' };
    const other = { user: { id: 'user-2' }, socketId: 'socket-2' };
    const orderSet = new Set([ws, other]);
    const driverSet = new Set([ws]);
    __testing.setTrackingSubscriptions(new Map([
      ['order-1', orderSet],
      ['driver-9', driverSet],
    ]));

    await __testing.removeClientFromAllSubscriptions(ws);

    const subscriptions = __testing.getTrackingSubscriptions();
    expect(subscriptions.get('order-1')).toEqual(new Set([other]));
    expect(subscriptions.has('driver-9')).toBe(false);
  });

  it('expires the Redis subscription key only for the last socket of a user', async () => {
    const ws = { user: { id: 'user-1' }, socketId: 'socket-1' };
    __testing.setTrackingSubscriptions(new Map([['order-1', new Set([ws])]]));

    await __testing.removeClientFromAllSubscriptions(ws);

    expect(redisMock.expire).toHaveBeenCalledTimes(1);
    expect(redisMock.expire).toHaveBeenCalledWith('user:subscriptions:user-1', 3600);
  });
});
