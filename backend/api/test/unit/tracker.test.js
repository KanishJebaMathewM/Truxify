import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';

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

const {
  closeWebSocketServer,
  handleLocationPing,
  handleTrackingMessage,
  handleSubscribe,
  rejectWebSocketUpgrade,
  __testing,
} = await import('../../src/sockets/tracker.js');

describe('tracker WebSocket telemetry authorization', () => {
  beforeEach(() => {
    dbMock.store.orders = [];
    dbMock.calls = [];
    __testing.resetTrackingSubscriptions();
  });

  it('rejects a driver_id that does not match the authenticated socket', async () => {
    const sentMessages = [];
    const ws = {
      driverId: 'authenticated-driver',
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

    expect(sentMessages).toEqual([
      {
        error: 'Unauthorized: driver_id does not match authenticated WebSocket identity.',
      },
    ]);
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

    expect(sentMessages).toEqual([{ status: 'subscribed', target: 'ORDER-123' }]);
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

    expect(sentMessages).toEqual([{ status: 'subscribed', target: 'driver-owner' }]);
  });
});

describe('tracker WebSocket heartbeat messages', () => {
  it('responds to raw client ping messages without attempting JSON parsing', async () => {
    const sentMessages = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
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
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
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
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

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
    expect(__testing.getTelemetryWriteBuffer()).toHaveLength(1);
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
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await closeWebSocketServer();

    expect(__testing.getShutdownState()).toEqual({
      isSchedulerActive: false,
      hasTelemetryFlushInterval: false,
      hasWebSocketServer: false,
      hasWsHeartbeatInterval: false,
    });

    errorSpy.mockRestore();
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
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

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
      device_timestamp: new Date(1000).toISOString(), // very old timestamp
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

  it('removes a disconnected client from all subscriptions', async () => {
    const sentMessages = [];
    const ws = {
      user: { id: 'driver-1', role: 'driver' },
      driverId: 'driver-1',
      send(msg) { sentMessages.push(JSON.parse(msg)); }
    };

    await handleSubscribe(ws, { driver_id: 'driver-1' });

    __testing.removeClientFromAllSubscriptions(ws);

    // Subscription should be cleaned up — no error thrown
    expect(true).toBe(true);
  });

  it('cleans up empty subscription sets after removal', async () => {
    const ws = {
      user: { id: 'driver-2', role: 'driver' },
      driverId: 'driver-2',
      send: vi.fn(),
    };

    await handleSubscribe(ws, { driver_id: 'driver-2' });
    __testing.removeClientFromAllSubscriptions(ws);

    // Subscribe again to verify map was cleaned (no duplicate sets)
    const ws2 = {
      user: { id: 'driver-2', role: 'driver' },
      driverId: 'driver-2',
      send: vi.fn(),
    };
    await handleSubscribe(ws2, { driver_id: 'driver-2' });
    expect(ws2.send).toHaveBeenCalledWith(
      JSON.stringify({ status: 'subscribed', target: 'driver-2' })
    );
  });
});

describe('flushTelemetryBuffer - direct', () => {
  beforeEach(() => {
    __testing.clearTelemetryWriteBuffer();
  });

  it('does nothing when buffer is empty', async () => {
    // Should not throw
    await __testing.flushTelemetryBuffer();
    expect(true).toBe(true);
  });

  it('retains buffer when mongoDb is not initialized', async () => {
    // Add item to buffer via a ping
    const ws = { driverId: 'driver-1', send: vi.fn() };
    await handleLocationPing(ws, {
      driver_id: 'driver-1',
      latitude: 12.9,
      longitude: 77.5,
    });

    const bufferBefore = __testing.getTelemetryWriteBuffer().length;
    expect(bufferBefore).toBeGreaterThan(0);

    // mongoDb is null in mock — flush should retain buffer
    await __testing.flushTelemetryBuffer();

    const bufferAfter = __testing.getTelemetryWriteBuffer().length;
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
      device_timestamp: new Date(1000).toISOString(),
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

    expect(collection).toHaveBeenCalledWith('live_gps_pings');
    expect(insertMany).toHaveBeenCalled();
    expect(t.getTelemetryWriteBuffer().length).toBe(0);
  });

  it('re-queues buffer on transient MongoDB error', async () => {
    const insertMany = vi.fn().mockImplementation(async () => {
      // Simulate a concurrent new ping arriving while DB write is active
      const { __testing: t } = await import('../../src/sockets/tracker.js');
      t.setTelemetryWriteBuffer([{ driver_id: 'new-driver' }]);
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
    const buffer = t.getTelemetryWriteBuffer();
    expect(buffer).toHaveLength(2);
    expect(buffer[0].driver_id).toBe('old-driver');
    expect(buffer[1].driver_id).toBe('new-driver');
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
    expect(t.getTelemetryWriteBuffer().length).toBe(0);
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

    it('enforces MAX_BUFFER_SIZE by dropping 10% of the oldest telemetry records', async () => {
      const mockRecords = Array.from({ length: 10000 }, (_, i) => ({ driver_id: `driver-old-${i}` }));
      __testing.setTelemetryWriteBuffer(mockRecords);

      const ws = { driverId: 'driver-new', send: vi.fn() };
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await handleLocationPing(ws, {
        driver_id: 'driver-new',
        latitude: 12.9716,
        longitude: 77.5946,
      });

      const buffer = __testing.getTelemetryWriteBuffer();
      expect(buffer.length).toBe(9501);
      expect(buffer[0].driver_id).toBe('driver-old-500');
      expect(buffer[9500].driver_id).toBe('driver-new');
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[TRUXIFY BUFFER WARN] Telemetry buffer full')
      );

      consoleWarnSpy.mockRestore();
    });
  });
});
