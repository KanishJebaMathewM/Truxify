import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

const mockRedisClient = null;
vi.mock('../src/config/db.js', () => ({
  get mongoDb() { return null; },
  get redisClient() { return mockRedisClient; },
  get firebaseAdmin() { return null; },
  get supabase() { return null; },
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
    it('allows upgrade when no Redis client', async () => {
      const req = makeRequest();
      const result = await isWebSocketUpgradeAllowed(req);
      expect(result).toBe(true);
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
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ error: 'Unauthorized: Missing authenticated WebSocket identity.' }));
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
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ error: 'Missing mandatory tracking parameters (lat, lng).' }));
    });

    it('rejects out-of-range coordinates', async () => {
      const ws = makeWs();
      await handleLocationPing(ws, { lat: 100, lng: 72.8 });
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ error: 'Coordinates out of valid range' }));
    });

    it('buffers valid location ping', async () => {
      const ws = makeWs();
      await handleLocationPing(ws, { lat: 19.076, lng: 72.877 });
      const rawBuf = __testing.getTelemetryWriteBuffer();
      const buffer = rawBuf.toArray ? rawBuf.toArray() : rawBuf;
      expect(buffer.length).toBe(1);
      expect(buffer[0].lat).toBe(19.076);
      expect(buffer[0].lng).toBe(72.877);
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
  });

  describe('__testing helpers', () => {
    it('getTrackingSubscriptions returns a Map', () => {
      const subs = __testing.getTrackingSubscriptions();
      expect(subs).toBeInstanceOf(Map);
    });

    it('getTelemetryWriteBuffer returns an array', () => {
      const rawBuf = __testing.getTelemetryWriteBuffer();
      const buf = rawBuf.toArray ? rawBuf.toArray() : rawBuf;
      expect(Array.isArray(buf)).toBe(true);
    });
  });
});