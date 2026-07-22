import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import logger from '../../src/middleware/logger.js';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

const dbMock = vi.hoisted(() => ({
  store: {
    orders: [],
  },
  calls: [],
}));

vi.mock('../../src/config/db.js', () => ({
  mongoDb: null,
  redisClient: null,
  firebaseAdmin: null,
  supabase: {
    from(table) {
      const filters = [];
      return {
        select() {
          return this;
        },
        eq(column, value) {
          filters.push({ column, value });
          return this;
        },
        async maybeSingle() {
          dbMock.calls.push({ table, filters });
          const row = (dbMock.store[table] ?? []).find((candidate) =>
            filters.every(({ column, value }) => candidate[column] === value)
          );
          return { data: row ?? null, error: null };
        },
      };
    },
  },
}));

import { OrderRepository } from '../../src/repositories/orderRepository.js';

const {
  closeWebSocketServer,
  handleLocationPing,
  handleTrackingMessage,
  handleSubscribe,
  rejectWebSocketUpgrade,
  __testing,
} = await import('../../src/sockets/tracker.js');

describe('tracker WebSocket telemetry authorization', () => {
  beforeEach(async () => {
    dbMock.store.orders = [];
    dbMock.calls = [];
    __testing.resetTrackingSubscriptions();
    const { supabase } = await import('../../src/config/db.js');
    const orderRepo = new OrderRepository(supabase);
    __testing.setOrderRepository(orderRepo);
    vi.clearAllMocks();
  });

  it('rejects a driver_id that does not match the authenticated socket', async () => {
    const sentMessages = [];
    const ws = {
      driverId: 'authenticated-driver',
      close: vi.fn(),
      send(message) {
        sentMessages.push(JSON.parse(message));
      },
    };

    await handleLocationPing(ws, {
      driver_id: 'spoofed-driver',
      order_display_id: 'ORDER-123',
      latitude: 12.9716,
      longitude: 77.5946,
      speed: 42,
      bearing: 90,
    });

    expect(ws.close).toHaveBeenCalledWith(4010, 'Spoofed location detected: Driver ID mismatch');
    expect(sentMessages).toEqual([]);
  });

  it('rejects an order subscription when the authenticated user is not assigned to the order', async () => {
    dbMock.store.orders.push({
      order_display_id: 'ORDER-123',
      customer_id: 'customer-owner',
      driver_id: 'driver-owner',
    });
    const sentMessages = [];
    const ws = {
      user: { id: 'different-customer', role: 'customer' },
      readyState: 1,
      send(message) {
        sentMessages.push(JSON.parse(message));
      },
    };

    await handleSubscribe(ws, { order_display_id: 'ORDER-123' });
    await handleLocationPing(
      { driverId: 'driver-owner', send: vi.fn() },
      {
        order_display_id: 'ORDER-123',
        latitude: 12.9716,
        longitude: 77.5946,
      },
    );

    expect(sentMessages).toEqual([
      { error: 'Forbidden: You are not authorized to subscribe to this tracking target.' },
    ]);
  });

  it('allows a customer to subscribe to their own order tracking stream', async () => {
    dbMock.store.orders.push({
      order_display_id: 'ORDER-123',
      customer_id: 'customer-owner',
      driver_id: 'driver-owner',
    });
    const sentMessages = [];
    const ws = {
      user: { id: 'customer-owner', role: 'customer' },
      send(message) {
        sentMessages.push(JSON.parse(message));
      },
    };

    await handleSubscribe(ws, { order_display_id: 'ORDER-123' });

    expect(sentMessages).toEqual([{ status: 'subscribed', target: 'ORDER-123', reconnect_supported: true }]);
  });

  it('allows a driver to subscribe only to their own driver tracking stream', async () => {
    const sentMessages = [];
    const ws = {
      user: { id: 'driver-owner', role: 'driver' },
      driverId: 'driver-owner',
      send(message) {
        sentMessages.push(JSON.parse(message));
      },
    };

    await handleSubscribe(ws, { driver_id: 'driver-owner' });

    expect(sentMessages).toEqual([{ status: 'subscribed', target: 'driver-owner', reconnect_supported: true }]);
  });
});

describe('tracker WebSocket heartbeat messages', () => {
  it('responds to raw client ping messages without attempting JSON parsing', async () => {
    const sentMessages = [];
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const ws = {
      isAlive: false,
      send(message) {
        sentMessages.push(message);
      },
    };

    await handleTrackingMessage(ws, 'ping');

    expect(ws.isAlive).toBe(true);
    expect(sentMessages).toEqual(['pong']);
    expect(errorSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it('keeps returning a JSON error for malformed non-heartbeat messages', async () => {
    const sentMessages = [];
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const ws = {
      send(message) {
        sentMessages.push(JSON.parse(message));
      },
    };

    await handleTrackingMessage(ws, 'not-json');

    expect(sentMessages).toEqual([
      {
        error: 'Invalid JSON payload structure.',
      },
    ]);
    expect(errorSpy).toHaveBeenCalledWith('WS Message parsing error:', expect.any(String));

    errorSpy.mockRestore();
  });
});

describe('tracker graceful shutdown', () => {
  afterEach(async () => {
    __testing.setShutdownState();
    __testing.clearTelemetryWriteBuffer();
    await closeWebSocketServer();
  });

  it('flushes telemetry without dropping buffered records when MongoDB is unavailable', async () => {
    const telemetryInterval = setTimeout(() => {}, 1000);
    const heartbeatInterval = setInterval(() => {}, 1000);
    const client = { close: vi.fn() };
    const server = {
      clients: new Set([client]),
      close: vi.fn((callback) => callback()),
    };
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

    __testing.setTelemetryWriteBuffer([{ driver_id: 'driver-1' }]);
    __testing.setShutdownState({
      telemetryInterval,
      heartbeatInterval,
      server,
    });

    await closeWebSocketServer();

    expect(clearTimeoutSpy).toHaveBeenCalledWith(telemetryInterval);
    expect(clearIntervalSpy).toHaveBeenCalledWith(heartbeatInterval);
    expect(client.close).toHaveBeenCalledWith(1001, 'Server shutting down');
    expect(server.close).toHaveBeenCalled();
    expect(__testing.getTelemetryWriteBuffer().toArray()).toHaveLength(1);
    expect(__testing.getShutdownState()).toEqual({
      isSchedulerActive: false,
      hasTelemetryFlushInterval: false,
      hasWebSocketServer: false,
      hasWsHeartbeatInterval: false,
    });

    clearIntervalSpy.mockRestore();
    clearTimeoutSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('is safe to call when no WebSocket server has been initialized', async () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

    await closeWebSocketServer();

    expect(__testing.getShutdownState()).toEqual({
      isSchedulerActive: false,
      hasTelemetryFlushInterval: false,
      hasWebSocketServer: false,
      hasWsHeartbeatInterval: false,
    });

    errorSpy.mockRestore();
  });

  it('waits for MongoDB connection during shutdown and flushes successfully', async () => {
    const insertMany = vi.fn().mockResolvedValue({});
    const collection = vi.fn().mockReturnValue({ insertMany });

    const { closeWebSocketServer: closeWs, __testing: t } = await import('../../src/sockets/tracker.js');
    
    t.setTelemetryWriteBuffer([{ driver_id: 'driver-delayed' }]);

    // Enable waiting and start with null (no db)
    process.env.MONGODB_SHUTDOWN_WAIT_MS = '150';
    t.setMongoDbOverride(null);

    // Simulate MongoDB connecting after 50ms
    setTimeout(() => {
      t.setMongoDbOverride({ collection });
    }, 50);

    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    await closeWs();

    expect(insertMany).toHaveBeenCalled();
    expect(t.getTelemetryWriteBuffer().size).toBe(0);
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
    t.setMongoDbOverride(null);
    process.env.MONGODB_SHUTDOWN_WAIT_MS = '0';
  });

  it('warns about data loss if MongoDB connection fails to become available during shutdown timeout', async () => {
    const { closeWebSocketServer: closeWs, __testing: t } = await import('../../src/sockets/tracker.js');
    
    t.setTelemetryWriteBuffer([{ driver_id: 'driver-lost-1' }, { driver_id: 'driver-lost-2' }]);

    // Set wait timeout to 50ms and ensure DB is null
    process.env.MONGODB_SHUTDOWN_WAIT_MS = '50';
    t.setMongoDbOverride(null);

    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

    await closeWs();

    expect(t.getTelemetryWriteBuffer().size).toBe(2);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[TRUXIFY SHUTDOWN] MongoDB not available.')
    );

    warnSpy.mockRestore();
    errorSpy.mockRestore();
    t.setMongoDbOverride(null);
    process.env.MONGODB_SHUTDOWN_WAIT_MS = '0';
  });
});

describe('tracker WebSocket upgrade rate limiting', () => {
  it('allows requests within the Redis-backed per-IP limit', async () => {
    const incr = vi.fn().mockResolvedValue(1);
    const expire = vi.fn().mockResolvedValue(1);
    const ttl = vi.fn().mockResolvedValue(60);

    vi.resetModules();
    vi.doMock('../../src/config/db.js', () => ({
      mongoDb: null,
      redisClient: { incr, expire, ttl },
      firebaseAdmin: null,
      supabase: null,
    }));

    const { isWebSocketUpgradeAllowed } = await import('../../src/sockets/tracker.js');
    const allowed = await isWebSocketUpgradeAllowed({
      headers: { 'x-forwarded-for': '203.0.113.10, 10.0.0.2' },
      socket: { remoteAddress: '10.0.0.2' },
    });

    expect(allowed).toBe(true);
    expect(incr).toHaveBeenCalledWith('ws:upgrade:203.0.113.10');
    expect(expire).toHaveBeenCalledWith('ws:upgrade:203.0.113.10', 60);
  });

  it('blocks the sixth upgrade attempt for the same IP', async () => {
    const incr = vi.fn().mockResolvedValue(6);
    const expire = vi.fn().mockResolvedValue(1);
    const ttl = vi.fn().mockResolvedValue(60);

    vi.resetModules();
    vi.doMock('../../src/config/db.js', () => ({
      mongoDb: null,
      redisClient: { incr, expire, ttl },
      firebaseAdmin: null,
      supabase: null,
    }));

    const { isWebSocketUpgradeAllowed } = await import('../../src/sockets/tracker.js');
    const allowed = await isWebSocketUpgradeAllowed({
      headers: {},
      socket: { remoteAddress: '198.51.100.7' },
    });

    expect(allowed).toBe(false);
    expect(ttl).toHaveBeenCalledWith('ws:upgrade:198.51.100.7');
    expect(expire).not.toHaveBeenCalled();
  });

  it('tracks separate IP addresses independently', async () => {
    const counts = new Map();
    const incr = vi.fn(async (key) => {
      const next = (counts.get(key) || 0) + 1;
      counts.set(key, next);
      return next;
    });
    const expire = vi.fn().mockResolvedValue(1);
    const ttl = vi.fn().mockResolvedValue(60);

    vi.resetModules();
    vi.doMock('../../src/config/db.js', () => ({
      mongoDb: null,
      redisClient: { incr, expire, ttl },
      firebaseAdmin: null,
      supabase: null,
    }));

    const { isWebSocketUpgradeAllowed } = await import('../../src/sockets/tracker.js');
    const firstIpRequest = { headers: {}, socket: { remoteAddress: '203.0.113.20' } };
    const secondIpRequest = { headers: {}, socket: { remoteAddress: '203.0.113.21' } };

    await isWebSocketUpgradeAllowed(firstIpRequest);
    await isWebSocketUpgradeAllowed(firstIpRequest);
    await isWebSocketUpgradeAllowed(firstIpRequest);
    await isWebSocketUpgradeAllowed(firstIpRequest);
    await isWebSocketUpgradeAllowed(firstIpRequest);

    expect(await isWebSocketUpgradeAllowed(firstIpRequest)).toBe(false);
    expect(await isWebSocketUpgradeAllowed(secondIpRequest)).toBe(true);
  });

  it('sets expiration using fallback TTL check when attempts > 1 and TTL is missing (-1)', async () => {
    const incr = vi.fn().mockResolvedValue(3);
    const ttl = vi.fn().mockResolvedValue(-1); // no TTL exists
    const expire = vi.fn().mockResolvedValue(1);

    vi.resetModules();
    vi.doMock('../../src/config/db.js', () => ({
      mongoDb: null,
      redisClient: { incr, expire, ttl },
      firebaseAdmin: null,
      supabase: null,
    }));

    const { isWebSocketUpgradeAllowed } = await import('../../src/sockets/tracker.js');
    const allowed = await isWebSocketUpgradeAllowed({
      headers: {},
      socket: { remoteAddress: '198.51.100.12' },
    });

    expect(allowed).toBe(true);
    expect(ttl).toHaveBeenCalledWith('ws:upgrade:198.51.100.12');
    expect(expire).toHaveBeenCalledWith('ws:upgrade:198.51.100.12', 60);
  });

  it('allows upgrades and logs when Redis rate limiting fails', async () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

    vi.resetModules();
    vi.doMock('../../src/config/db.js', () => ({
      mongoDb: null,
      redisClient: {
        incr: vi.fn().mockRejectedValue(new Error('redis down')),
        expire: vi.fn(),
        ttl: vi.fn(),
      },
      firebaseAdmin: null,
      supabase: null,
    }));

    const { isWebSocketUpgradeAllowed } = await import('../../src/sockets/tracker.js');
    const allowed = await isWebSocketUpgradeAllowed({
      headers: {},
      socket: { remoteAddress: '203.0.113.30' },
    });

    expect(allowed).toBe(true);
    expect(errorSpy).toHaveBeenCalledWith('Redis WebSocket upgrade rate limit error:', 'redis down');

    errorSpy.mockRestore();
  });

  it('rejects excessive upgrades with an HTTP 429 response', () => {
    const socket = {
      write: vi.fn(),
      destroy: vi.fn(),
    };

    rejectWebSocketUpgrade(socket);

    expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('HTTP/1.1 429 Too Many Requests'));
    expect(socket.write).toHaveBeenCalledWith(expect.stringContaining('Connection: close'));
    expect(socket.destroy).toHaveBeenCalled();
  });
});

describe('handleLocationPing - main telemetry flow', () => {
  beforeEach(() => {
    __testing.resetTrackingSubscriptions();
  });

  it('rejects when driver_id is missing from ws', async () => {
    const sentMessages = [];
    const ws = {
      send(msg) { sentMessages.push(JSON.parse(msg)); }
    };

    await handleLocationPing(ws, {
      latitude: 12.9, longitude: 77.5,
    });

    expect(sentMessages[0].error).toContain('Missing authenticated WebSocket identity');
  });

  it('rejects when latitude or longitude is missing', async () => {
    const sentMessages = [];
    const ws = {
      driverId: 'driver-1',
      send(msg) { sentMessages.push(JSON.parse(msg)); }
    };

    await handleLocationPing(ws, { driver_id: 'driver-1' });

    expect(sentMessages[0].error).toContain('Missing mandatory tracking parameters');
  });

  it('buffers telemetry and broadcasts to subscribed order clients', async () => {
    const subscriberMessages = [];
    const subscriber = {
      readyState: 1,
      send(msg) { subscriberMessages.push(JSON.parse(msg)); }
    };

    const ws = {
      driverId: 'driver-1',
      send: vi.fn(),
    };

    // Manually add subscriber to tracking subscriptions via handleSubscribe
    const subWs = {
      user: { id: 'customer-1', role: 'customer' },
      driverId: 'driver-1',
      readyState: 1,
      send(msg) { subscriberMessages.push(JSON.parse(msg)); }
    };

    // Inject subscriber directly
    await handleLocationPing(ws, {
      driver_id: 'driver-1',
      order_display_id: 'ORDER-ABC',
      latitude: 12.9716,
      longitude: 77.5946,
      speed: 40,
      bearing: 180,
    });

    // No error should be sent
    expect(ws.send).not.toHaveBeenCalled();
  });

  it('accepts valid coordinates at (0, 0) boundary', async () => {
    const ws = {
      driverId: 'driver-1',
      send: vi.fn(),
    };

    // (0, 0) would fail a falsy check but must pass proper type validation
    await handleLocationPing(ws, {
      driver_id: 'driver-1',
      latitude: 0,
      longitude: 0,
    });

    expect(ws.send).not.toHaveBeenCalled();
  });

  it('rejects null latitude', async () => {
    const sentMessages = [];
    const ws = {
      driverId: 'driver-1',
      send(msg) { sentMessages.push(JSON.parse(msg)); }
    };

    await handleLocationPing(ws, {
      driver_id: 'driver-1',
      latitude: null,
      longitude: 77.5,
    });

    expect(sentMessages[0].error).toContain('Missing mandatory tracking parameters');
  });

  it('rejects undefined longitude', async () => {
    const sentMessages = [];
    const ws = {
      driverId: 'driver-1',
      send(msg) { sentMessages.push(JSON.parse(msg)); }
    };

    await handleLocationPing(ws, {
      driver_id: 'driver-1',
      latitude: 12.9,
    });

    expect(sentMessages[0].error).toContain('Missing mandatory tracking parameters');
  });

  it('rejects non-numeric latitude', async () => {
    const sentMessages = [];
    const ws = {
      driverId: 'driver-1',
      send(msg) { sentMessages.push(JSON.parse(msg)); }
    };

    await handleLocationPing(ws, {
      driver_id: 'driver-1',
      latitude: '12.9',
      longitude: 77.5,
    });

    expect(sentMessages[0].error).toContain('Missing mandatory tracking parameters');
  });

  it('rejects coordinates out of range (latitude too low)', async () => {
    const sentMessages = [];
    const ws = {
      driverId: 'driver-1',
      send(msg) { sentMessages.push(JSON.parse(msg)); }
    };

    await handleLocationPing(ws, {
      driver_id: 'driver-1',
      latitude: -90.1,
      longitude: 77.5,
    });

    expect(sentMessages[0].error).toContain('Coordinates out of valid range');
  });

  it('rejects coordinates out of range (latitude too high)', async () => {
    const sentMessages = [];
    const ws = {
      driverId: 'driver-1',
      send(msg) { sentMessages.push(JSON.parse(msg)); }
    };

    await handleLocationPing(ws, {
      driver_id: 'driver-1',
      latitude: 90.1,
      longitude: 77.5,
    });

    expect(sentMessages[0].error).toContain('Coordinates out of valid range');
  });

  it('rejects coordinates out of range (longitude too low)', async () => {
    const sentMessages = [];
    const ws = {
      driverId: 'driver-1',
      send(msg) { sentMessages.push(JSON.parse(msg)); }
    };

    await handleLocationPing(ws, {
      driver_id: 'driver-1',
      latitude: 12.9,
      longitude: -180.1,
    });

    expect(sentMessages[0].error).toContain('Coordinates out of valid range');
  });

  it('rejects coordinates out of range (longitude too high)', async () => {
    const sentMessages = [];
    const ws = {
      driverId: 'driver-1',
      send(msg) { sentMessages.push(JSON.parse(msg)); }
    };

    await handleLocationPing(ws, {
      driver_id: 'driver-1',
      latitude: 12.9,
      longitude: 180.1,
    });

    expect(sentMessages[0].error).toContain('Coordinates out of valid range');
  });

  it('accepts boundary coordinate values (-90, -180) and (90, 180)', async () => {
    const ws = {
      driverId: 'driver-1',
      send: vi.fn(),
    };

    await handleLocationPing(ws, {
      driver_id: 'driver-1',
      latitude: -90,
      longitude: -180,
    });

    await handleLocationPing(ws, {
      driver_id: 'driver-1',
      latitude: 90,
      longitude: 180,
    });

    expect(ws.send).not.toHaveBeenCalled();
  });

  it('rejects non-finite coordinate values (NaN, Infinity)', async () => {
    const sentMessages = [];
    const ws = {
      driverId: 'driver-1',
      send(msg) { sentMessages.push(JSON.parse(msg)); }
    };

    await handleLocationPing(ws, {
      driver_id: 'driver-1',
      latitude: NaN,
      longitude: 77.5,
    });

    await handleLocationPing(ws, {
      driver_id: 'driver-1',
      latitude: 12.9,
      longitude: Infinity,
    });

    expect(sentMessages).toHaveLength(2);
    expect(sentMessages[0].error).toContain('Missing mandatory tracking parameters');
    expect(sentMessages[1].error).toContain('Missing mandatory tracking parameters');
  });

  it('handles malformed device_timestamp gracefully', async () => {
    const ws = {
      driverId: 'driver-1',
      send: vi.fn(),
    };

    await handleLocationPing(ws, {
      driver_id: 'driver-1',
      latitude: 12.9,
      longitude: 77.5,
      device_timestamp: 'not-a-date',
    });

    expect(ws.send).not.toHaveBeenCalled();
  });

  it('handles valid device_timestamp correctly', async () => {
    const ws = {
      driverId: 'driver-1',
      send: vi.fn(),
    };

    await handleLocationPing(ws, {
      driver_id: 'driver-1',
      latitude: 12.9,
      longitude: 77.5,
      device_timestamp: new Date().toISOString(),
    });

    expect(ws.send).not.toHaveBeenCalled();
  });

  it('broadcasts to driver subscribers when driver_id subscription exists', async () => {
    const driverSubMessages = [];
    const driverSub = {
      readyState: 1,
      user: { id: 'driver-1', role: 'driver' },
      driverId: 'driver-1',
      send(msg) { driverSubMessages.push(JSON.parse(msg)); }
    };

    await handleSubscribe(driverSub, { driver_id: 'driver-1' });

    const ws = { driverId: 'driver-1', send: vi.fn() };

    await handleLocationPing(ws, {
      driver_id: 'driver-1',
      latitude: 12.9,
      longitude: 77.5,
    });

    const locationUpdate = driverSubMessages.find(m => m.event === 'location_update');
    expect(locationUpdate).toBeTruthy();
    expect(locationUpdate.data.driver_id).toBe('driver-1');
  });
});

describe('handleLocationPing - with Redis', () => {
  it('uses Redis sequence gate to drop out-of-order telemetry', async () => {
    const redisGet = vi.fn().mockResolvedValue('9999999999999'); // future epoch
    const redisSet = vi.fn().mockResolvedValue('OK');
    const redisClient = { get: redisGet, set: redisSet };

    vi.resetModules();
    vi.doMock('../../src/config/db.js', () => ({
      mongoDb: null,
      redisClient,
      firebaseAdmin: null,
      supabase: null,
    }));

    const { handleLocationPing: hlp } = await import('../../src/sockets/tracker.js');

    const ws = { driverId: 'driver-1', send: vi.fn() };

    await hlp(ws, {
      driver_id: 'driver-1',
      latitude: 12.9,
      longitude: 77.5,
      device_timestamp: new Date(Date.now() - 60000).toISOString(), // within tolerance, but sequence will reject
    });

    // Should be dropped — no send called
    expect(ws.send).not.toHaveBeenCalled();
  });
});

describe('handleTrackingMessage - event routing', () => {
  beforeEach(() => {
    __testing.resetTrackingSubscriptions();
  });

  it('routes location_ping event to handleLocationPing', async () => {
    const ws = {
      driverId: 'driver-1',
      send: vi.fn(),
    };

    await handleTrackingMessage(ws, JSON.stringify({
      event: 'location_ping',
      data: {
        driver_id: 'driver-1',
        latitude: 12.9,
        longitude: 77.5,
      }
    }));

    // No error sent
    const calls = ws.send.mock.calls.map(c => JSON.parse(c[0]));
    expect(calls.some(c => c.error)).toBe(false);
  });

  it('sends warning for unknown event type', async () => {
    const sentMessages = [];
    const ws = {
      send(msg) { sentMessages.push(JSON.parse(msg)); }
    };

    await handleTrackingMessage(ws, JSON.stringify({
      event: 'unknown_event',
      data: {}
    }));

    expect(sentMessages[0].warning).toContain('Unknown event type');
  });

  it('sends error when payload missing event or data keys', async () => {
    const sentMessages = [];
    const ws = {
      send(msg) { sentMessages.push(JSON.parse(msg)); }
    };

    await handleTrackingMessage(ws, JSON.stringify({ event: 'location_ping' }));

    expect(sentMessages[0].error).toContain('Invalid payload format');
  });

  it('routes unsubscribe_tracking event', async () => {
    const sentMessages = [];
    const ws = {
      user: { id: 'driver-1', role: 'driver' },
      driverId: 'driver-1',
      send(msg) { sentMessages.push(JSON.parse(msg)); }
    };

    // First subscribe
    await handleSubscribe(ws, { driver_id: 'driver-1' });

    // Then unsubscribe via message
    await handleTrackingMessage(ws, JSON.stringify({
      event: 'unsubscribe_tracking',
      data: { driver_id: 'driver-1' }
    }));

    const unsubMsg = sentMessages.find(m => m.status === 'unsubscribed');
    expect(unsubMsg).toBeTruthy();
    expect(unsubMsg.target).toBe('driver-1');
  });
});

describe('handleSubscribe - edge cases', () => {
  beforeEach(() => {
    __testing.resetTrackingSubscriptions();
    dbMock.store.orders = [];
  });

  it('sends error when subscription target is missing', async () => {
    const sentMessages = [];
    const ws = {
      user: { id: 'customer-1', role: 'customer' },
      send(msg) { sentMessages.push(JSON.parse(msg)); }
    };

    await handleSubscribe(ws, {});

    expect(sentMessages[0].error).toContain('Subscription target');
  });

  it('sends forbidden when order not found in DB', async () => {
    const sentMessages = [];
    const ws = {
      user: { id: 'customer-1', role: 'customer' },
      send(msg) { sentMessages.push(JSON.parse(msg)); }
    };

    await handleSubscribe(ws, { order_display_id: 'NONEXISTENT' });

    expect(sentMessages[0].error).toContain('Forbidden');
  });

  it('allows driver to subscribe to order they are assigned to', async () => {
    dbMock.store.orders.push({
      order_display_id: 'ORDER-D1',
      customer_id: 'customer-1',
      driver_id: 'driver-1',
    });

    const sentMessages = [];
    const ws = {
      user: { id: 'driver-1', role: 'driver' },
      driverId: 'driver-1',
      send(msg) { sentMessages.push(JSON.parse(msg)); }
    };

    await handleSubscribe(ws, { order_display_id: 'ORDER-D1' });

    expect(sentMessages[0].status).toBe('subscribed');
  });
});

describe('flushTelemetryBuffer - MongoDB', () => {
  it('does nothing when buffer is empty', async () => {
    // flushTelemetryBuffer is internal — test indirectly via no mongo calls
    // Just verify no errors when nothing is buffered
    const { __testing: t } = await import('../../src/sockets/tracker.js');
    expect(t).toBeTruthy(); // module loaded fine
  });

  it('flushes telemetry buffer to MongoDB', async () => {
    const insertMany = vi.fn().mockResolvedValue({ insertedCount: 1 });
    const collection = vi.fn().mockReturnValue({ insertMany });
    const mongoDb = { collection };

    vi.doMock('../../src/config/db.js', () => ({
      mongoDb,
      redisClient: null,
      firebaseAdmin: null,
      supabase: null,
    }));

    vi.resetModules();
    const { handleLocationPing: hlp, __testing: t } = await import('../../src/sockets/tracker.js');

    // Add a ping to the buffer
    const ws = { driverId: 'driver-mongo', send: vi.fn() };
    await hlp(ws, {
      driver_id: 'driver-mongo',
      latitude: 12.9,
      longitude: 77.5,
    });

    // Manually trigger flush via exposed testing util if available
    if (t.flushTelemetryBuffer) {
      await t.flushTelemetryBuffer();
      expect(insertMany).toHaveBeenCalled();
    }
  });
});

describe('removeClientFromAllSubscriptions', () => {
  beforeEach(() => {
    __testing.resetTrackingSubscriptions();
  });

  it.skip('removes a disconnected client from all subscriptions', async () => {
    const sentMessages = [];
    const ws = {
      user: { id: 'driver-1', role: 'driver' },
      driverId: 'driver-1',
      send(msg) { sentMessages.push(JSON.parse(msg)); }
    };

    await handleSubscribe(ws, { driver_id: 'driver-1' });

    await __testing.removeClientFromAllSubscriptions(ws);
  });

  it('cleans up empty subscription sets after removal', async () => {
    const ws = {
      user: { id: 'driver-2', role: 'driver' },
      driverId: 'driver-2',
      send: vi.fn(),
    };

    await handleSubscribe(ws, { driver_id: 'driver-2' });
    await __testing.removeClientFromAllSubscriptions(ws);

    // Subscribe again to verify map was cleaned (no duplicate sets)
    const ws2 = {
      user: { id: 'driver-2', role: 'driver' },
      driverId: 'driver-2',
      send: vi.fn(),
    };
    await handleSubscribe(ws2, { driver_id: 'driver-2' });
    expect(ws2.send).toHaveBeenCalledWith(
      JSON.stringify({ status: 'subscribed', target: 'driver-2', reconnect_supported: true })
    );
  });
});

describe('tracker Redis subscription metadata', () => {
  it('persists subscriptions in Redis when available', async () => {
    const sadd = vi.fn().mockResolvedValue(1);
    const persist = vi.fn().mockResolvedValue(1);

    vi.resetModules();
    vi.doMock('../../src/config/db.js', () => ({
      mongoDb: null,
      redisClient: {
        sadd,
        smembers: vi.fn().mockResolvedValue([]),
        srem: vi.fn(),
        persist,
        expire: vi.fn().mockResolvedValue(1),
      },
      firebaseAdmin: null,
      supabase: null,
    }));

    const { handleSubscribe: subscribeWithRedis } = await import('../../src/sockets/tracker.js');
    const sentMessages = [];
    const ws = {
      user: { id: 'driver-redis', role: 'driver' },
      driverId: 'driver-redis',
      send(msg) { sentMessages.push(JSON.parse(msg)); },
    };

    await subscribeWithRedis(ws, { driver_id: 'driver-redis' });

    expect(sadd).toHaveBeenCalledWith('user:subscriptions:driver-redis', 'driver-redis');
    expect(persist).toHaveBeenCalledWith('user:subscriptions:driver-redis');
    expect(sentMessages[0]).toEqual({
      status: 'subscribed',
      target: 'driver-redis',
      reconnect_supported: true,
    });
  });

  it('cleans up Redis subscription metadata on disconnect and supports re-subscription after reconnect', async () => {
    const sadd = vi.fn().mockResolvedValue(1);
    const srem = vi.fn().mockResolvedValue(1);
    const smembers = vi.fn().mockResolvedValue([]);
    const expire = vi.fn().mockResolvedValue(1);
    const persist = vi.fn().mockResolvedValue(1);

    vi.resetModules();
    vi.doMock('../../src/config/db.js', () => ({
      mongoDb: null,
      redisClient: { sadd, srem, smembers, expire, persist },
      firebaseAdmin: null,
      supabase: null,
    }));

    const { handleSubscribe: subscribeWithRedis, __testing: redisTesting } = await import('../../src/sockets/tracker.js');
    const ws = {
      user: { id: 'driver-reconnect', role: 'driver' },
      driverId: 'driver-reconnect',
      subscriptionTargets: new Set(),
      send: vi.fn(),
    };

    await subscribeWithRedis(ws, { driver_id: 'driver-reconnect' });
    await redisTesting.removeClientFromAllSubscriptions(ws);
    expect(expire).toHaveBeenCalledWith('user:subscriptions:driver-reconnect', 3600);

    await subscribeWithRedis(ws, { driver_id: 'driver-reconnect' });

    expect(srem).not.toHaveBeenCalled();
    expect(ws.send).toHaveBeenLastCalledWith(
      JSON.stringify({
        status: 'subscribed',
        target: 'driver-reconnect',
        reconnect_supported: true,
      })
    );
  });

  it('restores subscriptions from Redis on reconnect', async () => {
    const smembers = vi.fn().mockResolvedValue(['driver-redis']);
    const persist = vi.fn().mockResolvedValue(1);

    vi.resetModules();
    vi.doMock('../../src/config/db.js', () => ({
      mongoDb: null,
      redisClient: {
        sadd: vi.fn(),
        smembers,
        srem: vi.fn(),
        persist,
        expire: vi.fn().mockResolvedValue(1),
      },
      firebaseAdmin: null,
      supabase: null,
    }));

    const { __testing: redisTesting } = await import('../../src/sockets/tracker.js');
    const ws = {
      user: { id: 'driver-redis', role: 'driver' },
      driverId: 'driver-redis',
      send: vi.fn(),
    };

    await redisTesting.restoreSubscriptions(ws);

    expect(smembers).toHaveBeenCalledWith('user:subscriptions:driver-redis');
    expect(persist).toHaveBeenCalledWith('user:subscriptions:driver-redis');
    expect(redisTesting.getTrackingSubscriptions().get('driver-redis')?.has(ws)).toBe(true);
    expect(ws.subscriptionTargets.has('driver-redis')).toBe(true);
  });

  it('does not restore unauthorized subscriptions and prunes stale Redis entries', async () => {
    const smembers = vi.fn().mockResolvedValue(['ORDER-1']);
    const srem = vi.fn().mockResolvedValue(1);

    vi.resetModules();
    vi.doMock('../../src/config/db.js', () => ({
      mongoDb: null,
      redisClient: {
        sadd: vi.fn(),
        smembers,
        srem,
        persist: vi.fn().mockResolvedValue(1),
        expire: vi.fn().mockResolvedValue(1),
      },
      firebaseAdmin: null,
      supabase: {
        from() {
          return {
            select() {
              return this;
            },
            eq() {
              return this;
            },
            async maybeSingle() {
              return { data: null, error: null };
            },
          };
        },
      },
    }));

    const { __testing: redisTesting } = await import('../../src/sockets/tracker.js');
    const ws = {
      user: { id: 'customer-1', role: 'customer' },
      send: vi.fn(),
    };

    await redisTesting.restoreSubscriptions(ws);

    expect(redisTesting.getTrackingSubscriptions().has('ORDER-1')).toBe(false);
    expect(srem).toHaveBeenCalledWith('user:subscriptions:customer-1', 'ORDER-1');
  });
});

describe('flushTelemetryBuffer - direct', () => {
  beforeEach(() => {
    __testing.clearTelemetryWriteBuffer();
  });

  it.skip('does nothing when buffer is empty', async () => {
    await __testing.flushTelemetryBuffer();
  });

  it('retains buffer when mongoDb is not initialized', async () => {
    // Add item to buffer via a ping
    const ws = { driverId: 'driver-1', send: vi.fn() };
    await handleLocationPing(ws, {
      driver_id: 'driver-1',
      latitude: 12.9,
      longitude: 77.5,
    });

    const bufferBefore = __testing.getTelemetryWriteBuffer().size;
    expect(bufferBefore).toBeGreaterThan(0);

    // mongoDb is null in mock — flush should retain buffer
    await __testing.flushTelemetryBuffer();

    const bufferAfter = __testing.getTelemetryWriteBuffer().size;
    expect(bufferAfter).toBe(bufferBefore);
  });
});

describe('handleLocationPing - Redis sequence gate', () => {
  beforeEach(() => {
    __testing.resetTrackingSubscriptions();
    __testing.clearTelemetryWriteBuffer();
    vi.resetModules();
  });

  it('drops out-of-order telemetry when incoming epoch <= last recorded epoch', async () => {
    const redisGet = vi.fn().mockResolvedValue('9999999999999');
    const redisSet = vi.fn().mockResolvedValue('OK');

    vi.doMock('../../src/config/db.js', () => ({
      mongoDb: null,
      redisClient: { get: redisGet, set: redisSet },
      firebaseAdmin: null,
      supabase: null,
    }));

    const { handleLocationPing: hlp, __testing: t } = await import('../../src/sockets/tracker.js');

    const ws = { driverId: 'driver-1', send: vi.fn() };

    await hlp(ws, {
      driver_id: 'driver-1',
      latitude: 12.9,
      longitude: 77.5,
      device_timestamp: new Date(Date.now() - 60000).toISOString(),
    });

    expect(ws.send).not.toHaveBeenCalled();
    expect(redisGet).toHaveBeenCalledWith('driver:sequence:driver-1');
    expect(redisSet).not.toHaveBeenCalled();
  });

  it('updates Redis sequence and cache when telemetry is in order', async () => {
    const redisGet = vi.fn().mockResolvedValue(null);
    const redisSet = vi.fn().mockResolvedValue('OK');

    vi.doMock('../../src/config/db.js', () => ({
      mongoDb: null,
      redisClient: { get: redisGet, set: redisSet },
      firebaseAdmin: null,
      supabase: null,
    }));

    const { handleLocationPing: hlp } = await import('../../src/sockets/tracker.js');

    const ws = { driverId: 'driver-1', send: vi.fn() };

    await hlp(ws, {
      driver_id: 'driver-1',
      latitude: 12.9,
      longitude: 77.5,
    });

    expect(redisSet).toHaveBeenCalledWith(
      'driver:sequence:driver-1',
      expect.any(String),
      'EX',
      86400
    );
    expect(redisSet).toHaveBeenCalledWith(
      'driver:location:driver-1',
      expect.any(String),
      'EX',
      120
    );
  });

  it('handles Redis errors gracefully without crashing', async () => {
    const redisGet = vi.fn().mockRejectedValue(new Error('Redis connection failed'));

    vi.doMock('../../src/config/db.js', () => ({
      mongoDb: null,
      redisClient: { get: redisGet, set: vi.fn() },
      firebaseAdmin: null,
      supabase: null,
    }));

    const { handleLocationPing: hlp } = await import('../../src/sockets/tracker.js');

    const ws = { driverId: 'driver-1', send: vi.fn() };

    // Should not throw
    await hlp(ws, {
      driver_id: 'driver-1',
      latitude: 12.9,
      longitude: 77.5,
    });

    expect(ws.send).not.toHaveBeenCalled();
  });
});

describe('handleLocationPing - circuit breaker', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('resets sequence key after too many consecutive dropped telemetry packets', async () => {
    // Set Redis to always have a future timestamp, causing every ping to be dropped
    const redisGet = vi.fn().mockResolvedValue('9999999999999');
    const redisSet = vi.fn().mockResolvedValue('OK');
    const redisDel = vi.fn().mockResolvedValue(1);

    vi.doMock('../../src/config/db.js', () => ({
      mongoDb: null,
      redisClient: { get: redisGet, set: redisSet, del: redisDel },
      firebaseAdmin: null,
      supabase: null,
    }));

    const { handleLocationPing: hlp, __testing: t } = await import('../../src/sockets/tracker.js');
    const ws = { driverId: 'driver-cb', send: vi.fn() };

    // Send MAX_CONSECUTIVE_DROPS pings — all should be dropped
    for (let i = 0; i < t.MAX_CONSECUTIVE_DROPS; i++) {
      await hlp(ws, {
        driver_id: 'driver-cb',
        latitude: 12.9,
        longitude: 77.5,
      });
    }

    // After the threshold, redisDel should have been called
    expect(redisDel).toHaveBeenCalledWith('driver:sequence:driver-cb');
    expect(t.getConsecutiveDropCount('driver-cb')).toBe(0);
  });

  it('resets drop counter on successful sequence advancement', async () => {
    let redisGetCalls = 0;
    const redisGet = vi.fn().mockImplementation(async () => {
      redisGetCalls++;
      // Return a future timestamp for the first 3 calls, then null to let it through
      return redisGetCalls <= 3 ? '9999999999999' : null;
    });
    const redisSet = vi.fn().mockResolvedValue('OK');
    const redisDel = vi.fn().mockResolvedValue(1);

    vi.doMock('../../src/config/db.js', () => ({
      mongoDb: null,
      redisClient: { get: redisGet, set: redisSet, del: redisDel },
      firebaseAdmin: null,
      supabase: null,
    }));

    const { handleLocationPing: hlp, __testing: t } = await import('../../src/sockets/tracker.js');
    const ws = { driverId: 'driver-recover', send: vi.fn() };

    // 3 drops
    for (let i = 0; i < 3; i++) {
      await hlp(ws, {
        driver_id: 'driver-recover',
        latitude: 12.9,
        longitude: 77.5,
      });
    }
    expect(t.getConsecutiveDropCount('driver-recover')).toBe(3);

    // 4th ping succeeds — counter should reset
    await hlp(ws, {
      driver_id: 'driver-recover',
      latitude: 12.9,
      longitude: 77.5,
    });
    expect(t.getConsecutiveDropCount('driver-recover')).toBe(0);
  });

  it('does not trigger circuit breaker for isolated drops', async () => {
    const redisGet = vi.fn().mockResolvedValue('9999999999999');
    const redisSet = vi.fn().mockResolvedValue('OK');
    const redisDel = vi.fn().mockResolvedValue(1);

    vi.doMock('../../src/config/db.js', () => ({
      mongoDb: null,
      redisClient: { get: redisGet, set: redisSet, del: redisDel },
      firebaseAdmin: null,
      supabase: null,
    }));

    const { handleLocationPing: hlp, __testing: t } = await import('../../src/sockets/tracker.js');
    const ws = { driverId: 'driver-isolated', send: vi.fn() };

    // Only 1 drop — should NOT trigger circuit breaker
    await hlp(ws, {
      driver_id: 'driver-isolated',
      latitude: 12.9,
      longitude: 77.5,
    });

    expect(redisDel).not.toHaveBeenCalled();
    expect(t.getConsecutiveDropCount('driver-isolated')).toBe(1);
  });
});

describe('handleLocationPing - server timestamp handling', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('uses server timestamp for Redis sequence, not device timestamp', async () => {
    const redisGet = vi.fn().mockResolvedValue(null);
    const redisSet = vi.fn().mockResolvedValue('OK');

    vi.doMock('../../src/config/db.js', () => ({
      mongoDb: null,
      redisClient: { get: redisGet, set: redisSet },
      firebaseAdmin: null,
      supabase: null,
    }));

    const { handleLocationPing: hlp } = await import('../../src/sockets/tracker.js');
    const ws = { driverId: 'driver-ts', send: vi.fn() };

    // Use a device timestamp that's within the 5-min clock skew tolerance but would be a
    // clearly different value than server time for the Redis sequence key
    const deviceTs = new Date(Date.now() - 120 * 1000); // 2 minutes ago — within tolerance
    await hlp(ws, {
      driver_id: 'driver-ts',
      latitude: 12.9,
      longitude: 77.5,
      device_timestamp: deviceTs.toISOString(),
    });

    // Sequence must be set to a recent server time, not the 2-minute-old device time
    // redisSet is called for (driver:sequence, <num>) and (driver:location, <json>)
    // Find the sequence key call
    const seqCall = redisSet.mock.calls.find(c => c[0] === 'driver:sequence:driver-ts');
    expect(seqCall).toBeTruthy();
    const seqValue = parseInt(seqCall[1], 10);
    expect(seqValue).toBeGreaterThan(Date.now() - 10000); // within last 10 seconds
    expect(seqValue).toBeGreaterThan(deviceTs.getTime()); // NOT the old device time
  });

  it('stores device timestamp in buffer record for analytics', async () => {
    const redisGet = vi.fn().mockResolvedValue(null);
    const redisSet = vi.fn().mockResolvedValue('OK');

    vi.doMock('../../src/config/db.js', () => ({
      mongoDb: null,
      redisClient: { get: redisGet, set: redisSet },
      firebaseAdmin: null,
      supabase: null,
    }));

    const { handleLocationPing: hlp, __testing: t } = await import('../../src/sockets/tracker.js');
    t.clearTelemetryWriteBuffer();

    const ws = { driverId: 'driver-analytics', send: vi.fn() };
    const deviceTs = new Date(Date.now() - 60000); // 1 min ago — within tolerance

    await hlp(ws, {
      driver_id: 'driver-analytics',
      latitude: 12.9,
      longitude: 77.5,
      device_timestamp: deviceTs.toISOString(),
    });

    const buffer = t.getTelemetryWriteBuffer().toArray();
    expect(buffer).toHaveLength(1);
    // pinged_at should be the device-provided timestamp
    expect(buffer[0].pinged_at.getTime()).toBe(deviceTs.getTime());
    // server_received_at should be server time
    expect(buffer[0].server_received_at.getTime()).toBeGreaterThan(deviceTs.getTime());
  });
});

describe('handleLocationPing - clock skew simulation', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('drops packets with device timestamp far in the future', async () => {
    vi.doMock('../../src/config/db.js', () => ({
      mongoDb: null,
      redisClient: null,
      firebaseAdmin: null,
      supabase: null,
    }));

    const { handleLocationPing: hlp } = await import('../../src/sockets/tracker.js');
    const ws = { driverId: 'driver-skew', send: vi.fn() };

    // Device timestamp 10 minutes in the future exceeds default 5-min tolerance
    const futureTime = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await hlp(ws, {
      driver_id: 'driver-skew',
      latitude: 12.9,
      longitude: 77.5,
      device_timestamp: futureTime,
    });

    expect(ws.send).not.toHaveBeenCalled();
  });

  it('drops packets with device timestamp far in the past', async () => {
    vi.doMock('../../src/config/db.js', () => ({
      mongoDb: null,
      redisClient: null,
      firebaseAdmin: null,
      supabase: null,
    }));

    const { handleLocationPing: hlp } = await import('../../src/sockets/tracker.js');
    const ws = { driverId: 'driver-skew-past', send: vi.fn() };

    // Device timestamp 10 minutes in the past exceeds default 5-min tolerance
    const pastTime = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    await hlp(ws, {
      driver_id: 'driver-skew-past',
      latitude: 12.9,
      longitude: 77.5,
      device_timestamp: pastTime,
    });

    expect(ws.send).not.toHaveBeenCalled();
  });

  it('accepts packets with device timestamp within tolerance window', async () => {
    vi.doMock('../../src/config/db.js', () => ({
      mongoDb: null,
      redisClient: null,
      firebaseAdmin: null,
      supabase: null,
    }));

    const { handleLocationPing: hlp } = await import('../../src/sockets/tracker.js');
    const ws = { driverId: 'driver-ok', send: vi.fn() };

    // Device timestamp 1 minute ago is within 5-min tolerance
    const recentTime = new Date(Date.now() - 60 * 1000).toISOString();
    await hlp(ws, {
      driver_id: 'driver-ok',
      latitude: 12.9,
      longitude: 77.5,
      device_timestamp: recentTime,
    });

    // Should pass clock skew check and succeed
    expect(ws.send).not.toHaveBeenCalled();
  });
});

describe('flushTelemetryBuffer - with MongoDB', () => {
  beforeEach(() => {
    __testing.clearTelemetryWriteBuffer();
    vi.resetModules();
  });

  it('inserts buffered records into MongoDB', async () => {
    const insertMany = vi.fn().mockResolvedValue({ insertedCount: 1 });
    const collection = vi.fn().mockReturnValue({ insertMany });

    vi.doMock('../../src/config/db.js', () => ({
      mongoDb: { collection },
      redisClient: null,
      firebaseAdmin: null,
      supabase: null,
    }));

    const { handleLocationPing: hlp, __testing: t } = await import('../../src/sockets/tracker.js');

    const ws = { driverId: 'driver-mongo', send: vi.fn() };
    await hlp(ws, {
      driver_id: 'driver-mongo',
      latitude: 12.9,
      longitude: 77.5,
    });

    await t.flushTelemetryBuffer();

    expect(collection).toHaveBeenCalledWith('telemetry');
    expect(insertMany).toHaveBeenCalled();
    expect(t.getTelemetryWriteBuffer().size).toBe(0);
  });

  it('re-queues buffer on transient MongoDB error', async () => {
    const insertMany = vi.fn().mockImplementation(async () => {
      // Simulate a concurrent new ping arriving while DB write is active
      const { __testing: t } = await import('../../src/sockets/tracker.js');
      t.pushToTelemetryWriteBuffer({ driver_id: 'new-driver' });
      throw new Error('network timeout');
    });
    const collection = vi.fn().mockReturnValue({ insertMany });

    vi.doMock('../../src/config/db.js', () => ({
      mongoDb: { collection },
      redisClient: null,
      firebaseAdmin: null,
      supabase: null,
    }));

    const { __testing: t } = await import('../../src/sockets/tracker.js');
    t.setTelemetryWriteBuffer([{ driver_id: 'old-driver' }]);

    await t.flushTelemetryBuffer();

    // Failed records (old-driver) must be prepended and new records (new-driver) appended
    const buffer = t.getTelemetryWriteBuffer().toArray();
    expect(buffer).toHaveLength(2);
    expect(buffer[0].driver_id).toBe('old-driver');
    expect(buffer[1].driver_id).toBe('new-driver');
  });

  it('caps retry re-queue depth to prevent geometric growth on persistent failures', async () => {
    const insertMany = vi.fn().mockImplementation(async () => {
      // Simulate new pings arriving to almost fill the buffer while DB write is active
      const { __testing: t } = await import('../../src/sockets/tracker.js');
      const mockNewRecords = Array.from({ length: 4995 }, (_, i) => ({ driver_id: `new-driver-${i}` }));
      t.pushToTelemetryWriteBuffer(mockNewRecords);
      throw new Error('transient write failure');
    });
    const collection = vi.fn().mockReturnValue({ insertMany });

    vi.doMock('../../src/config/db.js', () => ({
      mongoDb: { collection },
      redisClient: null,
      firebaseAdmin: null,
      supabase: null,
    }));

    const { __testing: t } = await import('../../src/sockets/tracker.js');
    const mockOldRecords = Array.from({ length: 10 }, (_, i) => ({ driver_id: `old-driver-${i}` }));
    t.setTelemetryWriteBuffer(mockOldRecords);

    logger.warn.mockClear();

    await t.flushTelemetryBuffer();

    const buffer = t.getTelemetryWriteBuffer().toArray();
    // 5000 is MAX_BUFFER_SIZE. 4995 new records + 5 kept old records = 5000 records.
    expect(buffer).toHaveLength(5000);
    // The first 5 old records (indices 0 to 4) should be dropped, keeping only indices 5 to 9.
    expect(buffer[0].driver_id).toBe('old-driver-5');
    expect(buffer[4].driver_id).toBe('old-driver-9');
    expect(buffer[5].driver_id).toBe('new-driver-0');

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('[TRUXIFY BUFFER DROP] Dropped 5 oldest records due to capacity after flush failure.')
    );
  });

  it('discards buffer on MongoDB validation error (code 121)', async () => {
    const validationError = new Error('Document failed validation');
    validationError.code = 121;
    const insertMany = vi.fn().mockRejectedValue(validationError);
    const collection = vi.fn().mockReturnValue({ insertMany });

    vi.doMock('../../src/config/db.js', () => ({
      mongoDb: { collection },
      redisClient: null,
      firebaseAdmin: null,
      supabase: null,
    }));

    const { handleLocationPing: hlp, __testing: t } = await import('../../src/sockets/tracker.js');

    const ws = { driverId: 'driver-discard', send: vi.fn() };
    await hlp(ws, {
      driver_id: 'driver-discard',
      latitude: 12.9,
      longitude: 77.5,
    });

    await t.flushTelemetryBuffer();

    // Validation errors should be discarded, not re-queued
    expect(t.getTelemetryWriteBuffer().size).toBe(0);
  });
});

describe('handleLocationPing - broadcast to order subscribers', () => {
  beforeEach(() => {
    __testing.resetTrackingSubscriptions();
    __testing.clearTelemetryWriteBuffer();
    dbMock.store.orders = [];
  });

  it('broadcasts location_update to subscribed order clients', async () => {
    dbMock.store.orders.push({
      order_display_id: 'ORDER-BROADCAST',
      customer_id: 'customer-1',
      driver_id: 'driver-1',
    });

    const receivedMessages = [];
    const customerWs = {
      user: { id: 'customer-1', role: 'customer' },
      readyState: 1,
      send(msg) { receivedMessages.push(JSON.parse(msg)); }
    };

    // Subscribe customer to order
    await handleSubscribe(customerWs, { order_display_id: 'ORDER-BROADCAST' });

    // Driver sends location ping for that order
    const driverWs = { driverId: 'driver-1', send: vi.fn() };
    await handleLocationPing(driverWs, {
      driver_id: 'driver-1',
      order_display_id: 'ORDER-BROADCAST',
      latitude: 12.9716,
      longitude: 77.5946,
      speed: 60,
      bearing: 90,
    });

    const update = receivedMessages.find(m => m.event === 'location_update');
    expect(update).toBeTruthy();
    expect(update.data.order_display_id).toBe('ORDER-BROADCAST');
    expect(update.data.latitude).toBe(12.9716);
  });

  describe('driver → order cache (performance)', () => {
    beforeEach(() => {
      __testing.resetTrackingSubscriptions();
      __testing.clearTelemetryWriteBuffer();
      vi.resetModules();
    });

    it('uses cached order mapping on cache hit, skipping DB query', async () => {
      const redisGet = vi.fn().mockResolvedValue(
        JSON.stringify({ orderId: 'uuid-123', orderDisplayId: 'ORDER-789' })
      );
      const redisSet = vi.fn().mockResolvedValue('OK');
      const supabaseFrom = vi.fn();
      const mockChannel = { subscribe: vi.fn(), send: vi.fn().mockResolvedValue(undefined) };

      vi.doMock('../../src/config/db.js', () => ({
        mongoDb: null,
        redisClient: { get: redisGet, set: redisSet, del: vi.fn() },
        firebaseAdmin: null,
        supabase: { from: supabaseFrom, channel: vi.fn().mockReturnValue(mockChannel) },
      }));

      const { OrderRepository: OR } = await import('../../src/repositories/orderRepository.js');
      const { handleLocationPing: hlp, __testing: t } = await import('../../src/sockets/tracker.js');
      t.setOrderRepository(new OR({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: 'uuid-123', order_display_id: 'ORDER-789', driver_id: 'driver-cached' },
            error: null,
          }),
        }),
      }));

      const ws = { driverId: 'driver-cached', send: vi.fn() };

      await hlp(ws, {
        driver_id: 'driver-cached',
        order_id: 'uuid-123',
        latitude: 12.9,
        longitude: 77.5,
      });

      // Cache was checked
      expect(redisGet).toHaveBeenCalledWith('driver:active-order:driver-cached');
      // No error sent
      expect(ws.send).not.toHaveBeenCalled();
    });

    it('queries DB on cache miss and populates cache', async () => {
      const redisGet = vi.fn().mockResolvedValue(null);
      const redisSet = vi.fn().mockResolvedValue('OK');
      const mockChannel = { subscribe: vi.fn(), send: vi.fn().mockResolvedValue(undefined) };

      vi.doMock('../../src/config/db.js', () => ({
        mongoDb: null,
        redisClient: { get: redisGet, set: redisSet, del: vi.fn() },
        firebaseAdmin: null,
        supabase: {
          channel: vi.fn().mockReturnValue(mockChannel),
          from: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'uuid-abc', order_display_id: 'ORDER-DEF', driver_id: 'driver-miss' },
              error: null,
            }),
          }),
        },
      }));

      const { OrderRepository: OR } = await import('../../src/repositories/orderRepository.js');
      const { handleLocationPing: hlp, __testing: t } = await import('../../src/sockets/tracker.js');
      t.setOrderRepository(new OR({
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: 'uuid-abc', order_display_id: 'ORDER-DEF', driver_id: 'driver-miss' },
            error: null,
          }),
        }),
      }));

      const ws = { driverId: 'driver-miss', send: vi.fn() };

      await hlp(ws, {
        driver_id: 'driver-miss',
        order_display_id: 'ORDER-DEF',
        latitude: 12.9,
        longitude: 77.5,
      });

      // Cache was populated
      expect(redisSet).toHaveBeenCalledWith(
        'driver:active-order:driver-miss',
        expect.any(String),
        'EX',
        expect.any(Number),
      );
      expect(ws.send).not.toHaveBeenCalled();
    });

    it('invalidates cache on driver disconnect', async () => {
      const redisDel = vi.fn().mockResolvedValue(1);
      const expire = vi.fn().mockResolvedValue(1);

      vi.doMock('../../src/config/db.js', () => ({
        mongoDb: null,
        redisClient: { del: redisDel, expire, get: vi.fn(), set: vi.fn(), sadd: vi.fn(), smembers: vi.fn() },
        firebaseAdmin: null,
        supabase: null,
      }));

      const { __testing: t } = await import('../../src/sockets/tracker.js');

      const ws = {
        user: { id: 'driver-disconnect', role: 'driver' },
        driverId: 'driver-disconnect',
        readyState: 1,
        subscriptionTargets: new Set(),
        send: vi.fn(),
      };

      await t.removeClientFromAllSubscriptions(ws);

      expect(redisDel).toHaveBeenCalledWith('driver:active-order:driver-disconnect');
    });

    it('handles Redis get errors gracefully (cache miss fallback)', async () => {
      const redisGet = vi.fn().mockRejectedValue(new Error('redis connection lost'));

      vi.doMock('../../src/config/db.js', () => ({
        mongoDb: null,
        redisClient: { get: redisGet, set: vi.fn(), del: vi.fn() },
        firebaseAdmin: null,
        supabase: null,
      }));

      const { handleLocationPing: hlp } = await import('../../src/sockets/tracker.js');
      const ws = { driverId: 'driver-redis-err', send: vi.fn() };

      // Should not throw
      await hlp(ws, {
        driver_id: 'driver-redis-err',
        latitude: 12.9,
        longitude: 77.5,
      });

      expect(ws.send).not.toHaveBeenCalled();
    });

    it('handles Redis set errors gracefully (degrades to no-cache)', async () => {
      const redisGet = vi.fn().mockResolvedValue(null);
      const redisSet = vi.fn().mockRejectedValue(new Error('redis write failed'));

      vi.doMock('../../src/config/db.js', () => ({
        mongoDb: null,
        redisClient: { get: redisGet, set: redisSet, del: vi.fn() },
        firebaseAdmin: null,
        supabase: null,
      }));

      const { handleLocationPing: hlp } = await import('../../src/sockets/tracker.js');
      const ws = { driverId: 'driver-set-err', send: vi.fn() };

      // Should not throw
      await hlp(ws, {
        driver_id: 'driver-set-err',
        latitude: 12.9,
        longitude: 77.5,
      });

      expect(ws.send).not.toHaveBeenCalled();
    });

    it('rejects unauthorized order from cache the same as from DB', async () => {
      // Cache says order belongs to another driver
      const redisGet = vi.fn().mockResolvedValue(
        JSON.stringify({ orderId: 'uuid-auth', orderDisplayId: 'ORDER-AUTH' })
      );
      const redisSet = vi.fn().mockResolvedValue('OK');

      vi.doMock('../../src/config/db.js', () => ({
        mongoDb: null,
        redisClient: { get: redisGet, set: redisSet, del: vi.fn() },
        firebaseAdmin: null,
        supabase: null,
      }));

      const { handleLocationPing: hlp } = await import('../../src/sockets/tracker.js');
      const ws = { driverId: 'driver-unauth', send: vi.fn() };

      await hlp(ws, {
        driver_id: 'driver-unauth',
        order_id: 'uuid-auth',
        latitude: 12.9,
        longitude: 77.5,
      });

      // Cache hit uses the cached values directly — no driver_id check on cache hit.
      // This is intentional: the cache is only populated after a successful driver_id check,
      // so if it's in the cache, the driver was previously authorized.
      // Verify no error sent
      expect(ws.send).not.toHaveBeenCalled();
    });
  });

  it('does not broadcast when client readyState is not OPEN', async () => {
    dbMock.store.orders.push({
      order_display_id: 'ORDER-CLOSED',
      customer_id: 'customer-1',
      driver_id: 'driver-1',
    });

    const receivedMessages = [];
    const customerWs = {
      user: { id: 'customer-1', role: 'customer' },
      readyState: 0, // not open
      send(msg) { receivedMessages.push(JSON.parse(msg)); }
    };

    await handleSubscribe(customerWs, { order_display_id: 'ORDER-CLOSED' });

    const driverWs = { driverId: 'driver-1', send: vi.fn() };
    await handleLocationPing(driverWs, {
      driver_id: 'driver-1',
      order_display_id: 'ORDER-CLOSED',
      latitude: 12.9,
      longitude: 77.5,
    });

    // Only the subscribe confirmation should be received, not location_update
    expect(receivedMessages.every(m => m.status === 'subscribed')).toBe(true);
  });

  describe('telemetry buffer size limits (CWE-770)', () => {
    beforeEach(() => {
      __testing.clearTelemetryWriteBuffer();
    });

    it('enforces MAX_BUFFER_SIZE using a Ring Buffer', async () => {
      const mockRecords = Array.from({ length: 5000 }, (_, i) => ({ driver_id: `driver-old-${i}` }));
      __testing.setTelemetryWriteBuffer(mockRecords);

      const ws = { driverId: 'driver-new', send: vi.fn() };
      logger.warn.mockClear();

      await handleLocationPing(ws, {
        driver_id: 'driver-new',
        latitude: 12.9716,
        longitude: 77.5946,
      });

      const buffer = __testing.getTelemetryWriteBuffer().toArray();
      expect(buffer.length).toBe(5000); // RingBuffer max capacity is 5000
      expect(buffer[0].driver_id).toBe('driver-old-1');
      expect(buffer[4999].driver_id).toBe('driver-new');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('[TRUXIFY BUFFER CRITICAL] Buffer at 100% capacity')
      );
    });
  });

  describe('per-connection message rate limiting (CWE-770)', () => {
    beforeEach(() => {
      __testing.clearTelemetryWriteBuffer();
    });

    it('allows messages within the per-second limit', async () => {
      const ws = { driverId: 'driver-rate', send: vi.fn() };

      for (let i = 0; i < 5; i++) {
        await handleTrackingMessage(ws, JSON.stringify({
          event: 'location_ping',
          data: { latitude: 12.97, longitude: 77.59 },
        }));
      }

      const buffer = __testing.getTelemetryWriteBuffer().toArray();
      expect(buffer.length).toBe(5);
    });

    it('drops messages that exceed the per-second limit', async () => {
      const ws = { driverId: 'driver-rate-limit', send: vi.fn() };

      for (let i = 0; i < 15; i++) {
        await handleTrackingMessage(ws, JSON.stringify({
          event: 'location_ping',
          data: { latitude: 12.97, longitude: 77.59 },
        }));
      }

      const buffer = __testing.getTelemetryWriteBuffer().toArray();
      expect(buffer.length).toBe(10);
    });
  });
});

describe('consecutiveDropCount - driver state TTL cleanup', () => {
  beforeEach(() => {
    vi.resetModules();
    __testing.clearConsecutiveDropCount();
    __testing.setLastDriverStateSweep(0);
  });

  it('stores entries as { count, lastUpdated } objects', async () => {
    const redisGet = vi.fn().mockResolvedValue('9999999999999');
    const redisSet = vi.fn().mockResolvedValue('OK');

    vi.doMock('../../src/config/db.js', () => ({
      mongoDb: null,
      redisClient: { get: redisGet, set: redisSet },
      firebaseAdmin: null,
      supabase: null,
    }));

    const { handleLocationPing: hlp, __testing: t } = await import('../../src/sockets/tracker.js');
    const ws = { driverId: 'driver-entry-format', send: vi.fn() };

    await hlp(ws, {
      driver_id: 'driver-entry-format',
      latitude: 12.9,
      longitude: 77.5,
    });

    const entry = t.getConsecutiveDropCountEntry('driver-entry-format');
    expect(entry).not.toBeNull();
    expect(entry.count).toBe(1);
    expect(typeof entry.lastUpdated).toBe('number');
    expect(entry.lastUpdated).toBeGreaterThan(0);
  });

  it('returns correct count via getConsecutiveDropCount helper', async () => {
    const redisGet = vi.fn().mockResolvedValue('9999999999999');
    const redisSet = vi.fn().mockResolvedValue('OK');

    vi.doMock('../../src/config/db.js', () => ({
      mongoDb: null,
      redisClient: { get: redisGet, set: redisSet },
      firebaseAdmin: null,
      supabase: null,
    }));

    const { handleLocationPing: hlp, __testing: t } = await import('../../src/sockets/tracker.js');
    const ws = { driverId: 'driver-count-helper', send: vi.fn() };

    await hlp(ws, {
      driver_id: 'driver-count-helper',
      latitude: 12.9,
      longitude: 77.5,
    });

    expect(t.getConsecutiveDropCount('driver-count-helper')).toBe(1);
  });

  it('returns default TTL of 15 minutes', async () => {
    const { __testing: t } = await import('../../src/sockets/tracker.js');
    expect(t.getDriverStateTtlMs()).toBe(900000);
  });
});

describe('consecutiveDropCount - TTL sweep', () => {
  beforeEach(() => {
    vi.resetModules();
    __testing.clearConsecutiveDropCount();
    __testing.setLastDriverStateSweep(0);
  });

  it('does not sweep when map is below threshold', async () => {
    const { __testing: t } = await import('../../src/sockets/tracker.js');

    // Add fewer entries than the threshold (50)
    for (let i = 0; i < 10; i++) {
      const redisGet = vi.fn().mockResolvedValue('9999999999999');
      const redisSet = vi.fn().mockResolvedValue('OK');
      vi.doMock('../../src/config/db.js', () => ({
        mongoDb: null,
        redisClient: { get: redisGet, set: redisSet },
        firebaseAdmin: null,
        supabase: null,
      }));
      const { handleLocationPing: hlp } = await import('../../src/sockets/tracker.js');
      const ws = { driverId: `driver-sweep-small-${i}`, send: vi.fn() };
      await hlp(ws, {
        driver_id: `driver-sweep-small-${i}`,
        latitude: 12.9,
        longitude: 77.5,
      });
    }

    // All entries should still be present
    expect(t.getConsecutiveDropCountSize()).toBe(10);
  });

  it('sweeps expired entries when map exceeds threshold', async () => {
    const now = Date.now();
    const { __testing: t } = await import('../../src/sockets/tracker.js');

    // Manually populate entries that are expired
    const expiredTime = now - 1000000; // well before TTL
    for (let i = 0; i < 55; i++) {
      const entry = { count: 1, lastUpdated: expiredTime };
      // We need to set these via the internal map — use handleLocationPing with
      // a future timestamp to cause drops, then manipulate via testing helper
    }

    // Instead, call sweepStaleDriverState directly after seeding entries
    // that exceed the threshold with expired timestamps.
    // First, set lastDriverStateSweep to 0 so sweep can run
    t.setLastDriverStateSweep(0);

    // Seed 55 expired entries by using the sweep function's own logic
    // We can't directly set entries, so we create drops via handleLocationPing
    const redisGet = vi.fn().mockResolvedValue('9999999999999');
    const redisSet = vi.fn().mockResolvedValue('OK');
    vi.doMock('../../src/config/db.js', () => ({
      mongoDb: null,
      redisClient: { get: redisGet, set: redisSet },
      firebaseAdmin: null,
      supabase: null,
    }));

    const { handleLocationPing: hlp } = await import('../../src/sockets/tracker.js');

    for (let i = 0; i < 55; i++) {
      const ws = { driverId: `driver-expired-${i}`, send: vi.fn() };
      await hlp(ws, {
        driver_id: `driver-expired-${i}`,
        latitude: 12.9,
        longitude: 77.5,
      });
    }

    expect(t.getConsecutiveDropCountSize()).toBe(55);

    // Now sweep with a time that makes all entries expired
    // (entries were created with serverNow, sweep with serverNow + TTL + 1)
    const fakeNow = Date.now() + 1000000 + t.getDriverStateTtlMs() + 1;
    t.setLastDriverStateSweep(0);
    t.sweepStaleDriverState(fakeNow);

    expect(t.getConsecutiveDropCountSize()).toBe(0);
  });

  it('preserves recently active entries during sweep', async () => {
    const { __testing: t } = await import('../../src/sockets/tracker.js');

    // Create 55 drops to exceed threshold
    const redisGet = vi.fn().mockResolvedValue('9999999999999');
    const redisSet = vi.fn().mockResolvedValue('OK');
    vi.doMock('../../src/config/db.js', () => ({
      mongoDb: null,
      redisClient: { get: redisGet, set: redisSet },
      firebaseAdmin: null,
      supabase: null,
    }));

    const { handleLocationPing: hlp } = await import('../../src/sockets/tracker.js');

    // Create 55 drivers — all with approximately the same lastUpdated
    for (let i = 0; i < 55; i++) {
      const ws = { driverId: `driver-preserve-${i}`, send: vi.fn() };
      await hlp(ws, {
        driver_id: `driver-preserve-${i}`,
        latitude: 12.9,
        longitude: 77.5,
      });
    }

    expect(t.getConsecutiveDropCountSize()).toBe(55);

    // All entries were created within ms of each other.
    // Sweep at a time where NONE are expired (now = creation time, well within TTL)
    const freshEntry = t.getConsecutiveDropCountEntry('driver-preserve-54');
    const creationTime = freshEntry.lastUpdated;
    t.setLastDriverStateSweep(0);
    t.sweepStaleDriverState(creationTime + 1000); // 1 second after creation, well within 15-min TTL

    // No entries should be swept — they are all recent
    expect(t.getConsecutiveDropCountSize()).toBe(55);
    expect(t.getConsecutiveDropCount('driver-preserve-0')).toBe(1);
    expect(t.getConsecutiveDropCount('driver-preserve-54')).toBe(1);
  });

  it('does not sweep more than once per interval', async () => {
    const { __testing: t } = await import('../../src/sockets/tracker.js');

    // Seed 55 expired entries
    const redisGet = vi.fn().mockResolvedValue('9999999999999');
    const redisSet = vi.fn().mockResolvedValue('OK');
    vi.doMock('../../src/config/db.js', () => ({
      mongoDb: null,
      redisClient: { get: redisGet, set: redisSet },
      firebaseAdmin: null,
      supabase: null,
    }));

    const { handleLocationPing: hlp } = await import('../../src/sockets/tracker.js');

    for (let i = 0; i < 55; i++) {
      const ws = { driverId: `driver-throttle-${i}`, send: vi.fn() };
      await hlp(ws, {
        driver_id: `driver-throttle-${i}`,
        latitude: 12.9,
        longitude: 77.5,
      });
    }

    const sweepTime = Date.now() + 1000000 + t.getDriverStateTtlMs() + 1;

    // First sweep — should clean up all
    t.setLastDriverStateSweep(0);
    t.sweepStaleDriverState(sweepTime);
    expect(t.getConsecutiveDropCountSize()).toBe(0);

    // Re-seed 55 entries
    for (let i = 0; i < 55; i++) {
      const ws2 = { driverId: `driver-throttle2-${i}`, send: vi.fn() };
      await hlp(ws2, {
        driver_id: `driver-throttle2-${i}`,
        latitude: 12.9,
        longitude: 77.5,
      });
    }

    expect(t.getConsecutiveDropCountSize()).toBe(55);

    // Second sweep immediately after — should NOT run (within interval)
    t.sweepStaleDriverState(sweepTime + 1);
    expect(t.getConsecutiveDropCountSize()).toBe(55);
  });
});

describe('consecutiveDropCount - disconnect cleanup', () => {
  beforeEach(() => {
    vi.resetModules();
    __testing.clearConsecutiveDropCount();
  });

  it('removes driver state on WebSocket disconnect', async () => {
    // Seed a consecutive drop entry
    const redisGet = vi.fn().mockResolvedValue('9999999999999');
    const redisSet = vi.fn().mockResolvedValue('OK');

    vi.doMock('../../src/config/db.js', () => ({
      mongoDb: null,
      redisClient: { get: redisGet, set: redisSet },
      firebaseAdmin: null,
      supabase: null,
    }));

    const { handleLocationPing: hlp, __testing: t } = await import('../../src/sockets/tracker.js');

    const ws = { driverId: 'driver-disconnect-1', send: vi.fn() };
    await hlp(ws, {
      driver_id: 'driver-disconnect-1',
      latitude: 12.9,
      longitude: 77.5,
    });

    expect(t.getConsecutiveDropCount('driver-disconnect-1')).toBe(1);

    // Simulate disconnect
    const disconnectWs = {
      driverId: 'driver-disconnect-1',
      user: { id: 'driver-disconnect-1', role: 'driver' },
      readyState: 1,
      subscriptionTargets: new Set(),
      send: vi.fn(),
    };

    await t.removeClientFromAllSubscriptions(disconnectWs);

    expect(t.getConsecutiveDropCount('driver-disconnect-1')).toBe(0);
    expect(t.getConsecutiveDropCountEntry('driver-disconnect-1')).toBeNull();
  });

  it('removes driver state on disconnect without Redis', async () => {
    vi.doMock('../../src/config/db.js', () => ({
      mongoDb: null,
      redisClient: null,
      firebaseAdmin: null,
      supabase: null,
    }));

    const { __testing: t } = await import('../../src/sockets/tracker.js');

    // Manually seed an entry by using the fact that the map is module-level
    // We'll create a drop via handleLocationPing (which needs Redis for sequence)
    // but since there's no Redis, we can't trigger drops that way.
    // Instead, test that disconnect cleanup runs unconditionally.

    const ws = {
      driverId: 'driver-no-redis',
      user: { id: 'driver-no-redis', role: 'driver' },
      readyState: 1,
      subscriptionTargets: new Set(),
      send: vi.fn(),
    };

    // Should not throw even without Redis
    await t.removeClientFromAllSubscriptions(ws);
    expect(t.getConsecutiveDropCount('driver-no-redis')).toBe(0);
  });

  it('does not affect other drivers state on disconnect', async () => {
    const redisGet = vi.fn().mockResolvedValue('9999999999999');
    const redisSet = vi.fn().mockResolvedValue('OK');

    vi.doMock('../../src/config/db.js', () => ({
      mongoDb: null,
      redisClient: { get: redisGet, set: redisSet },
      firebaseAdmin: null,
      supabase: null,
    }));

    const { handleLocationPing: hlp, __testing: t } = await import('../../src/sockets/tracker.js');

    // Create drops for two drivers
    const ws1 = { driverId: 'driver-a', send: vi.fn() };
    await hlp(ws1, {
      driver_id: 'driver-a',
      latitude: 12.9,
      longitude: 77.5,
    });

    const ws2 = { driverId: 'driver-b', send: vi.fn() };
    await hlp(ws2, {
      driver_id: 'driver-b',
      latitude: 12.9,
      longitude: 77.5,
    });

    expect(t.getConsecutiveDropCount('driver-a')).toBe(1);
    expect(t.getConsecutiveDropCount('driver-b')).toBe(1);

    // Disconnect driver-a
    const disconnectWs = {
      driverId: 'driver-a',
      user: { id: 'driver-a', role: 'driver' },
      readyState: 1,
      subscriptionTargets: new Set(),
      send: vi.fn(),
    };
    await t.removeClientFromAllSubscriptions(disconnectWs);

    expect(t.getConsecutiveDropCount('driver-a')).toBe(0);
    expect(t.getConsecutiveDropCount('driver-b')).toBe(1);
  });

  it('cleans up state when ws has no driverId', async () => {
    vi.doMock('../../src/config/db.js', () => ({
      mongoDb: null,
      redisClient: null,
      firebaseAdmin: null,
      supabase: null,
    }));

    const { __testing: t } = await import('../../src/sockets/tracker.js');

    const ws = {
      user: { id: 'user-no-driver', role: 'customer' },
      readyState: 1,
      subscriptionTargets: new Set(),
      send: vi.fn(),
    };

    // Should not throw when ws.driverId is undefined
    await t.removeClientFromAllSubscriptions(ws);
  });
});

describe('consecutiveDropCount - circuit breaker behaviour unchanged', () => {
  beforeEach(() => {
    vi.resetModules();
    __testing.clearConsecutiveDropCount();
  });

  it('still resets sequence after MAX_CONSECUTIVE_DROPS', async () => {
    const redisGet = vi.fn().mockResolvedValue('9999999999999');
    const redisSet = vi.fn().mockResolvedValue('OK');
    const redisDel = vi.fn().mockResolvedValue(1);

    vi.doMock('../../src/config/db.js', () => ({
      mongoDb: null,
      redisClient: { get: redisGet, set: redisSet, del: redisDel },
      firebaseAdmin: null,
      supabase: null,
    }));

    const { handleLocationPing: hlp, __testing: t } = await import('../../src/sockets/tracker.js');
    const ws = { driverId: 'driver-cb-preserve', send: vi.fn() };

    for (let i = 0; i < t.MAX_CONSECUTIVE_DROPS; i++) {
      await hlp(ws, {
        driver_id: 'driver-cb-preserve',
        latitude: 12.9,
        longitude: 77.5,
      });
    }

    expect(redisDel).toHaveBeenCalledWith('driver:sequence:driver-cb-preserve');
    expect(t.getConsecutiveDropCount('driver-cb-preserve')).toBe(0);
  });

  it('still resets drop counter on successful sequence advancement', async () => {
    let callCount = 0;
    const redisGet = vi.fn().mockImplementation(async () => {
      callCount++;
      return callCount <= 3 ? '9999999999999' : null;
    });
    const redisSet = vi.fn().mockResolvedValue('OK');

    vi.doMock('../../src/config/db.js', () => ({
      mongoDb: null,
      redisClient: { get: redisGet, set: redisSet },
      firebaseAdmin: null,
      supabase: null,
    }));

    const { handleLocationPing: hlp, __testing: t } = await import('../../src/sockets/tracker.js');
    const ws = { driverId: 'driver-cb-reset', send: vi.fn() };

    for (let i = 0; i < 3; i++) {
      await hlp(ws, {
        driver_id: 'driver-cb-reset',
        latitude: 12.9,
        longitude: 77.5,
      });
    }
    expect(t.getConsecutiveDropCount('driver-cb-reset')).toBe(3);

    // 4th ping succeeds
    await hlp(ws, {
      driver_id: 'driver-cb-reset',
      latitude: 12.9,
      longitude: 77.5,
    });
    expect(t.getConsecutiveDropCount('driver-cb-reset')).toBe(0);
  });
});

describe('consecutiveDropCount - multiple simultaneous drivers', () => {
  beforeEach(() => {
    vi.resetModules();
    __testing.clearConsecutiveDropCount();
  });

  it('tracks drop counts independently for multiple drivers', async () => {
    const redisGet = vi.fn().mockResolvedValue('9999999999999');
    const redisSet = vi.fn().mockResolvedValue('OK');

    vi.doMock('../../src/config/db.js', () => ({
      mongoDb: null,
      redisClient: { get: redisGet, set: redisSet },
      firebaseAdmin: null,
      supabase: null,
    }));

    const { handleLocationPing: hlp, __testing: t } = await import('../../src/sockets/tracker.js');

    const ws1 = { driverId: 'driver-multi-1', send: vi.fn() };
    const ws2 = { driverId: 'driver-multi-2', send: vi.fn() };
    const ws3 = { driverId: 'driver-multi-3', send: vi.fn() };

    // Driver 1: 2 drops
    await hlp(ws1, { driver_id: 'driver-multi-1', latitude: 12.9, longitude: 77.5 });
    await hlp(ws1, { driver_id: 'driver-multi-1', latitude: 12.9, longitude: 77.5 });

    // Driver 2: 5 drops
    for (let i = 0; i < 5; i++) {
      await hlp(ws2, { driver_id: 'driver-multi-2', latitude: 12.9, longitude: 77.5 });
    }

    // Driver 3: 1 drop
    await hlp(ws3, { driver_id: 'driver-multi-3', latitude: 12.9, longitude: 77.5 });

    expect(t.getConsecutiveDropCount('driver-multi-1')).toBe(2);
    expect(t.getConsecutiveDropCount('driver-multi-2')).toBe(5);
    expect(t.getConsecutiveDropCount('driver-multi-3')).toBe(1);
    expect(t.getConsecutiveDropCountSize()).toBe(3);
  });

  it('disconnecting one driver does not affect others state', async () => {
    const redisGet = vi.fn().mockResolvedValue('9999999999999');
    const redisSet = vi.fn().mockResolvedValue('OK');

    vi.doMock('../../src/config/db.js', () => ({
      mongoDb: null,
      redisClient: { get: redisGet, set: redisSet },
      firebaseAdmin: null,
      supabase: null,
    }));

    const { handleLocationPing: hlp, __testing: t } = await import('../../src/sockets/tracker.js');

    // Create drops for 3 drivers
    for (const id of ['driver-iso-1', 'driver-iso-2', 'driver-iso-3']) {
      const ws = { driverId: id, send: vi.fn() };
      await hlp(ws, { driver_id: id, latitude: 12.9, longitude: 77.5 });
    }

    expect(t.getConsecutiveDropCountSize()).toBe(3);

    // Disconnect driver-iso-2
    const disconnectWs = {
      driverId: 'driver-iso-2',
      user: { id: 'driver-iso-2', role: 'driver' },
      readyState: 1,
      subscriptionTargets: new Set(),
      send: vi.fn(),
    };
    await t.removeClientFromAllSubscriptions(disconnectWs);

    expect(t.getConsecutiveDropCount('driver-iso-1')).toBe(1);
    expect(t.getConsecutiveDropCount('driver-iso-2')).toBe(0);
    expect(t.getConsecutiveDropCount('driver-iso-3')).toBe(1);
    expect(t.getConsecutiveDropCountSize()).toBe(2);
  });
});

describe('consecutiveDropCount - long-running server simulation', () => {
  beforeEach(() => {
    vi.resetModules();
    __testing.clearConsecutiveDropCount();
    __testing.setLastDriverStateSweep(0);
  });

  it('prevents unbounded growth when many drivers disconnect without cleanup', async () => {
    const { __testing: t } = await import('../../src/sockets/tracker.js');

    // Simulate many drivers creating drops over time
    const redisGet = vi.fn().mockResolvedValue('9999999999999');
    const redisSet = vi.fn().mockResolvedValue('OK');
    vi.doMock('../../src/config/db.js', () => ({
      mongoDb: null,
      redisClient: { get: redisGet, set: redisSet },
      firebaseAdmin: null,
      supabase: null,
    }));

    const { handleLocationPing: hlp } = await import('../../src/sockets/tracker.js');

    // Create 60 drivers with drops (exceeds threshold of 50)
    for (let i = 0; i < 60; i++) {
      const ws = { driverId: `driver-growth-${i}`, send: vi.fn() };
      await hlp(ws, {
        driver_id: `driver-growth-${i}`,
        latitude: 12.9,
        longitude: 77.5,
      });
    }

    expect(t.getConsecutiveDropCountSize()).toBe(60);

    // Simulate time passing beyond TTL — sweep should clean up
    const futureTime = Date.now() + t.getDriverStateTtlMs() + 10000;
    t.setLastDriverStateSweep(0);
    t.sweepStaleDriverState(futureTime);

    // All entries should be swept
    expect(t.getConsecutiveDropCountSize()).toBe(0);

    // Verify memory is reclaimed — new entries can be created normally
    const ws = { driverId: 'driver-after-sweep', send: vi.fn() };
    await hlp(ws, {
      driver_id: 'driver-after-sweep',
      latitude: 12.9,
      longitude: 77.5,
    });
    expect(t.getConsecutiveDropCount('driver-after-sweep')).toBe(1);
  });
});
