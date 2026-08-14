import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

const mockRedisClient = null;

// In-memory `driver_locations` store + chainable builder for the service-role
// client, used to verify the tracker's location writer (issue #8932).
const mockAdminStore = { driver_locations: [] };

function buildAdminBuilder(store) {
  const builder = {
    _filters: [],
    _data: null,
    _mode: null,
    eq(col, val) { builder._filters.push({ col, val }); return builder; },
    update(data) { builder._mode = 'update'; builder._data = data; return builder; },
    insert(data) { builder._mode = 'insert'; builder._data = data; return builder; },
    then(resolve) {
      let rows = store.slice();
      for (const f of builder._filters) {
        rows = rows.filter(r => r[f.col] === f.val);
      }
      if (builder._mode === 'update') {
        for (const row of rows) Object.assign(row, builder._data);
        return resolve({ data: rows[0] || null, error: null });
      }
      if (builder._mode === 'insert') {
        const row = { id: 'loc-' + store.length, ...builder._data };
        store.push(row);
        return resolve({ data: row, error: null });
      }
      return resolve({ data: rows, error: null });
    },
  };
  return builder;
}

const mockSupabaseAdmin = {
  from(table) {
    if (!mockAdminStore[table]) mockAdminStore[table] = [];
    return buildAdminBuilder(mockAdminStore[table]);
  },
};

vi.mock('../src/config/db.js', () => ({
  get mongoDb() { return null; },
  get redisClient() { return mockRedisClient; },
  get firebaseAdmin() { return null; },
  get supabase() { return null; },
  get supabaseAdmin() { return mockSupabaseAdmin; },
}));
vi.mock('../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const {
  isWebSocketUpgradeAllowed,
  rejectWebSocketUpgrade,
  handleTrackingMessage,
  handleLocationPing,
  handleSubscribe,
  closeWebSocketServer,
  isMessageRateLimited,
  __testing,
} = await import('../src/sockets/tracker.js');

function makeWs(overrides = {}) {
  return {
    driverId: 'driver-1',
    user: { id: 'user-1', role: 'driver' },
    send: vi.fn(),
    close: vi.fn(),
    isAlive: true,
    readyState: 1,
    subscriptionTargets: new Set(),
    socketId: 'socket_test_1',
    ...overrides,
  };
}

function makeRequest(ip = '127.0.0.1') {
  return {
    headers: { 'x-forwarded-for': ip },
    socket: { remoteAddress: ip },
    url: 'http://localhost/ws/tracking?token=test',
  };
}

describe('tracker', () => {
  beforeEach(() => {
    __testing.clearConsecutiveDropCount();
    __testing.clearTelemetryWriteBuffer();
  });

  afterEach(async () => {
    await closeWebSocketServer();
  });

  describe('isWebSocketUpgradeAllowed', () => {
    it('enforces the per-IP limit in memory when no Redis client is configured (no fail-open)', async () => {
      const req = makeRequest();
      for (let i = 0; i < 5; i++) {
        await expect(isWebSocketUpgradeAllowed(req)).resolves.toBe(true);
      }
      await expect(isWebSocketUpgradeAllowed(req)).resolves.toBe(false);
    });
  });

  describe('isMessageRateLimited', () => {
    it('falls back to the in-memory limiter when Redis is unavailable and never fails open', async () => {
      const ws = makeWs({ socketId: 'socket-rate-1' });
      for (let i = 0; i < 10; i++) {
        await expect(isMessageRateLimited(ws)).resolves.toBe(false);
      }
      // The 11th message inside the same 1-second window is limited.
      await expect(isMessageRateLimited(ws)).resolves.toBe(true);
    });

    it('limits sockets independently (per-socket window)', async () => {
      const wsA = makeWs({ socketId: 'socket-rate-a' });
      const wsB = makeWs({ socketId: 'socket-rate-b' });
      for (let i = 0; i < 10; i++) {
        await isMessageRateLimited(wsA);
      }
      await expect(isMessageRateLimited(wsA)).resolves.toBe(true);
      // A fresh socket has its own clean budget.
      for (let i = 0; i < 10; i++) {
        await expect(isMessageRateLimited(wsB)).resolves.toBe(false);
      }
    });

    it('rate-limited messages are dropped before processing', async () => {
      const ws = makeWs({ socketId: 'socket-rate-drop' });
      for (let i = 0; i < 10; i++) {
        await handleTrackingMessage(ws, 'ping');
      }
      ws.send.mockClear();
      await handleTrackingMessage(ws, 'ping');
      expect(ws.send).not.toHaveBeenCalled();
    });
  });

  describe('handleTrackingMessage', () => {
    it('responds to ping with pong', async () => {
      const ws = makeWs();
      await handleTrackingMessage(ws, 'ping');
      expect(ws.send).toHaveBeenCalledWith('pong');
    });

    it('sends error for invalid JSON', async () => {
      const ws = makeWs();
      await handleTrackingMessage(ws, 'not json');
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ error: 'Invalid JSON payload structure.' }));
    });

    it('sends error for payload missing event/data', async () => {
      const ws = makeWs();
      await handleTrackingMessage(ws, JSON.stringify({ event: 'test' }));
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ error: 'Invalid payload format. Must include "event" and "data" keys.' }));
    });
  });

  describe('handleLocationPing', () => {
    it('rejects when driver_id is missing', async () => {
      const ws = makeWs({ driverId: null });
      await handleLocationPing(ws, { lat: 19.0, lng: 72.8 });
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ error: 'Forbidden: Driver role required to publish location updates', code: 4003 }));
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({
        error: 'Forbidden: Driver role required to publish location updates',
        code: 4003,
      }));
    });

    it('rejects spoofed location with mismatched driver_id', async () => {
      const ws = makeWs();
      ws.close = vi.fn();
      await handleLocationPing(ws, { driver_id: 'other-driver', lat: 19.0, lng: 72.8 });
      expect(ws.close).toHaveBeenCalledWith(4010, 'Spoofed location detected: Driver ID mismatch');
    });

    it('rejects invalid coordinates', async () => {
      const ws = makeWs();
      await handleLocationPing(ws, { lat: 'abc', lng: 72.8 });
      expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('"error":"Invalid telemetry payload."'));
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({
        error: 'Invalid telemetry payload.',
        details: ['lat must be a valid number'],
      }));
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ error: 'Invalid telemetry payload.', details: ['lat must be a valid number'] }));
    });

    it('rejects out-of-range coordinates', async () => {
      const ws = makeWs();
      await handleLocationPing(ws, { lat: 100, lng: 72.8 });
      expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('"error":"Invalid telemetry payload."'));
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({
        error: 'Invalid telemetry payload.',
        details: ['lat must be <= 90'],
      }));
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ error: 'Invalid telemetry payload.', details: ['lat must be <= 90'] }));
    });

    it('buffers valid location ping', async () => {
      const ws = makeWs();
      await handleLocationPing(ws, { lat: 19.076, lng: 72.877 });
      // telemetryWriteBuffer is a TelemetryRingBuffer whose toArray() is async.
      const buffer = await __testing.getTelemetryWriteBuffer().toArray();
      expect(buffer.length).toBe(1);
      expect(buffer[0].lat).toBe(19.076);
      expect(buffer[0].lng).toBe(72.877);
    });

    it('writes an active driver_locations row for a valid ping', async () => {
      mockAdminStore.driver_locations = [];
      const ws = makeWs();
      await handleLocationPing(ws, { lat: 19.076, lng: 72.877 });
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(mockAdminStore.driver_locations).toHaveLength(1);
      expect(mockAdminStore.driver_locations[0]).toMatchObject({
        driver_id: 'driver-1',
        latitude: 19.076,
        longitude: 72.877,
        is_active: true,
      });
    });

    it('keeps only one active driver_locations row across pings', async () => {
      mockAdminStore.driver_locations = [];
      const ws = makeWs();
      await handleLocationPing(ws, { lat: 19.076, lng: 72.877 });
      await handleLocationPing(ws, { lat: 19.1, lng: 72.9 });
      await new Promise(resolve => setTimeout(resolve, 0));
      const active = mockAdminStore.driver_locations.filter(r => r.is_active);
      expect(active).toHaveLength(1);
      expect(active[0].latitude).toBe(19.1);
      expect(mockAdminStore.driver_locations).toHaveLength(2);
    });
  });

  describe('handleSubscribe', () => {
    it('rejects subscription without target', async () => {
      const ws = makeWs();
      await handleSubscribe(ws, {});
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ error: 'Subscription target (order_display_id or driver_id) is missing.' }));
    });

    it('subscribes to driver_id when authorized', async () => {
      const ws = makeWs();
      await handleSubscribe(ws, { driver_id: 'driver-1' });
      expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('"status":"subscribed"'));
    });

    it('rejects non-driver without an active order for the target driver', async () => {
      const ws = makeWs({ user: { id: 'customer-1', role: 'customer' } });
      await handleSubscribe(ws, { driver_id: 'driver-2' });
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({
        error: 'Forbidden: You are not authorized to subscribe to this tracking target.',
      }));
    });

    it('allows a customer with an active order for the target driver', async () => {
      __testing.setOrderRepository({
        findActiveOrderForDriverByCustomer: vi.fn().mockResolvedValue({
          data: { id: 'order-1', order_display_id: 'OD-1' },
          error: null,
        }),
      });
      const ws = makeWs({ user: { id: 'customer-1', role: 'customer' } });
      await handleSubscribe(ws, { driver_id: 'driver-2' });
      expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('"status":"subscribed"'));
    });
  });

  describe('__testing helpers', () => {
    it('getTrackingSubscriptions returns a Map', () => {
      const subs = __testing.getTrackingSubscriptions();
      expect(subs).toBeInstanceOf(Map);
    });

    it('getTelemetryWriteBuffer exposes the ring buffer, whose toArray() resolves to an array', async () => {
      const rawBuf = __testing.getTelemetryWriteBuffer();
      expect(typeof rawBuf.toArray).toBe('function');
      expect(typeof rawBuf.push).toBe('function');
      expect(Array.isArray(await rawBuf.toArray())).toBe(true);
    });
  });
});