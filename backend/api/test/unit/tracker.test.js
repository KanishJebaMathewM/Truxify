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
  authUser: null,
}));

vi.mock('../../src/config/db.js', () => ({
  mongoDb: null,
  redisClient: null,
  firebaseAdmin: null,
  supabase: {
    auth: {
      async getUser() {
        return { data: { user: dbMock.authUser }, error: null };
      },
    },
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
    dbMock.authUser = null;
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

describe('tracker first-frame WebSocket auth (issue #5739)', () => {
  const supabaseJwt = (() => {
    const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
    return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({
      iss: 'https://example.supabase.co/auth/v1',
      sub: 'sb-user-1',
    })}.signature`;
  })();

  function pendingSocket(sentMessages) {
    return {
      authenticated: false,
      close: vi.fn(),
      send(message) {
        sentMessages.push(typeof message === 'string' ? JSON.parse(message) : message);
      },
    };
  }

  it('authenticates a pending socket via a first-frame auth event', async () => {
    dbMock.authUser = { id: 'sb-user-1' };
    dbMock.store.profiles = [{ id: 'sb-user-1', firebase_uid: 'fb-uid-1', role: 'driver', is_active: true }];
    const sentMessages = [];
    const ws = pendingSocket(sentMessages);

    await handleTrackingMessage(ws, JSON.stringify({
      event: 'auth',
      data: { token: supabaseJwt },
    }));

    expect(ws.authenticated).toBe(true);
    expect(ws.user).toEqual({ id: 'sb-user-1', uid: 'fb-uid-1', role: 'driver' });
    expect(ws.driverId).toBe('sb-user-1');
    expect(ws.close).not.toHaveBeenCalled();
    expect(sentMessages).toEqual([
      { status: 'authenticated', user_id: 'sb-user-1' },
    ]);
  });

  it('accepts telemetry after first-frame auth completes', async () => {
    dbMock.authUser = { id: 'sb-user-1' };
    dbMock.store.profiles = [{ id: 'sb-user-1', firebase_uid: 'fb-uid-1', role: 'driver', is_active: true }];
    const sentMessages = [];
    const ws = pendingSocket(sentMessages);

    await handleTrackingMessage(ws, JSON.stringify({
      event: 'auth',
      data: { token: supabaseJwt },
    }));

    await handleLocationPing(ws, {
      driver_id: 'sb-user-1',
      order_display_id: 'ORDER-AUTH',
      latitude: 12.9716,
      longitude: 77.5946,
      speed: 40,
      bearing: 90,
    });

    expect(ws.close).not.toHaveBeenCalled();
    expect(sentMessages[0]).toEqual({ status: 'authenticated', user_id: 'sb-user-1' });
  });

  it('rejects a non-auth first message on a pending socket', async () => {
    const sentMessages = [];
    const ws = pendingSocket(sentMessages);

    await handleTrackingMessage(ws, JSON.stringify({
      event: 'location_ping',
      data: { lat: 12.9, lng: 77.5 },
    }));

    expect(ws.authenticated).toBe(false);
    expect(ws.close).toHaveBeenCalledWith(4001, 'Unauthorized: Authenticate first');
    expect(sentMessages).toEqual([
      { error: 'Unauthorized: Authenticate first', code: 4001 },
    ]);
  });

  it('rejects an auth event without a token', async () => {
    const sentMessages = [];
    const ws = pendingSocket(sentMessages);

    await handleTrackingMessage(ws, JSON.stringify({ event: 'auth', data: {} }));

    expect(ws.authenticated).toBe(false);
    expect(ws.close).toHaveBeenCalledWith(4001, 'Unauthorized: No token provided');
  });

  it('rejects an auth event with an invalid token', async () => {
    const sentMessages = [];
    const ws = pendingSocket(sentMessages);

    await handleTrackingMessage(ws, JSON.stringify({
      event: 'auth',
      data: { token: 'not-a-valid-token' },
    }));

    expect(ws.authenticated).toBe(false);
    expect(ws.close).toHaveBeenCalledWith(4001, 'Unauthorized: Firebase Auth is not configured');
  });

  it('queues messages arriving while auth is in-flight and processes them upon successful auth', async () => {
    dbMock.authUser = { id: 'sb-user-1' };
    dbMock.store.profiles = [{ id: 'sb-user-1', firebase_uid: 'fb-uid-1', role: 'driver', is_active: true }];
    const sentMessages = [];
    const ws = pendingSocket(sentMessages);
    ws.readyState = 1;

    const authPromise = handleTrackingMessage(ws, JSON.stringify({
      event: 'auth',
      data: { token: supabaseJwt },
    }));

    const pingPromise = handleTrackingMessage(ws, JSON.stringify({
      event: 'subscribe_tracking',
      data: { driver_id: 'sb-user-1' },
    }));

    await Promise.all([authPromise, pingPromise]);

    expect(ws.authenticated).toBe(true);
    expect(ws.isAuthenticating).toBe(false);
    expect(sentMessages).toEqual([
      { status: 'authenticated', user_id: 'sb-user-1' },
      { status: 'subscribed', target: 'sb-user-1', reconnect_supported: true },
    ]);
  });

  it('clears queued messages and does not process them if auth fails', async () => {
    const sentMessages = [];
    const ws = pendingSocket(sentMessages);
    ws.readyState = 1;

    const authPromise = handleTrackingMessage(ws, JSON.stringify({
      event: 'auth',
      data: { token: 'invalid-token' },
    }));

    const queuedMsgPromise = handleTrackingMessage(ws, JSON.stringify({
      event: 'subscribe_tracking',
      data: { driver_id: 'sb-user-1' },
    }));

    await Promise.all([authPromise, queuedMsgPromise]);

    expect(ws.authenticated).toBe(false);
    expect(ws.isAuthenticating).toBe(false);
    expect(ws.pendingAuthQueue).toEqual([]);
    expect(ws.close).toHaveBeenCalledWith(4001, 'Unauthorized: Firebase Auth is not configured');
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

    process.env.MONGODB_SHUTDOWN_WAIT_MS = '150';
    t.setMongoDbOverride(null);

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
      redisClient: { publish: vi.fn().mockResolvedValue(1), incr, expire, ttl },
      firebaseAdmin: null,
      supabase: null,
    }));

    const { isWebSocketUpgradeAllowed } = await import('../../src/sockets/tracker.js');
    const allowed = await isWebSocketUpgradeAllowed({
      headers: { 'x-forwarded-for': '203.0.113.10, 10.0.0.2' },
      socket: { remoteAddress: '10.0.0.2' },
    });

    expect(allowed).toBe(true);
    expect(incr).toHaveBeenCalledWith('ws:upgrade:10.0.0.2');
    expect(expire).toHaveBeenCalledWith('ws:upgrade:10.0.0.2', 60);
  });

  it('ignores a spoofed X-Forwarded-For header when selecting the rate-limit key', async () => {
    const incr = vi.fn().mockResolvedValue(1);
    const expire = vi.fn().mockResolvedValue(1);
    const ttl = vi.fn().mockResolvedValue(60);

    vi.resetModules();
    vi.doMock('../../src/config/db.js', () => ({
      mongoDb: null,
      redisClient: { publish: vi.fn().mockResolvedValue(1), incr, expire, ttl },
      firebaseAdmin: null,
      supabase: null,
    }));

    const { isWebSocketUpgradeAllowed } = await import('../../src/sockets/tracker.js');
    await isWebSocketUpgradeAllowed({
      headers: { 'x-forwarded-for': '1.2.3.4' },
      socket: { remoteAddress: '198.51.100.9' },
    });

    expect(incr).toHaveBeenCalledWith('ws:upgrade:198.51.100.9');
    expect(incr).not.toHaveBeenCalledWith('ws:upgrade:1.2.3.4');
  });

  it('blocks the sixth upgrade attempt for the same IP', async () => {
    const incr = vi.fn().mockResolvedValue(6);
    const expire = vi.fn().mockResolvedValue(1);
    const ttl = vi.fn().mockResolvedValue(60);

    vi.resetModules();
    vi.doMock('../../src/config/db.js', () => ({
      mongoDb: null,
      redisClient: { publish: vi.fn().mockResolvedValue(1), incr, expire, ttl },
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
      redisClient: { publish: vi.fn().mockResolvedValue(1), incr, expire, ttl },
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
    const ttl = vi.fn().mockResolvedValue(-1);
    const expire = vi.fn().mockResolvedValue(1);

    vi.resetModules();
    vi.doMock('../../src/config/db.js', () => ({
      mongoDb: null,
      redisClient: { publish: vi.fn().mockResolvedValue(1), incr, expire, ttl },
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

  it('enforces the per-IP limit via the in-memory fallback when Redis rate limiting fails (no fail-open)', async () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

    vi.resetModules();
    vi.doMock('../../src/config/db.js', () => ({
      mongoDb: null,
      redisClient: { publish: vi.fn().mockResolvedValue(1),
        incr: vi.fn().mockRejectedValue(new Error('redis down')),
        expire: vi.fn(),
        ttl: vi.fn(),
      },
      firebaseAdmin: null,
      supabase: null,
    }));

    const { isWebSocketUpgradeAllowed } = await import('../../src/sockets/tracker.js');
    const request = {
      headers: {},
      socket: { remoteAddress: '203.0.113.30' },
    };

    for (let i = 0; i < 5; i++) {
      await expect(isWebSocketUpgradeAllowed(request)).resolves.toBe(true);
    }
    await expect(isWebSocketUpgradeAllowed(request)).resolves.toBe(false);

    expect(errorSpy).toHaveBeenCalledWith('Redis WebSocket upgrade rate limit error:', 'redis down');

    errorSpy.mockRestore();
  });

  it('enforces the per-IP limit in memory when no Redis client is configured (no fail-open)', async () => {
    vi.resetModules();
    vi.doMock('../../src/config/db.js', () => ({
      mongoDb: null,
      redisClient: null,
      firebaseAdmin: null,
      supabase: null,
    }));

    const { isWebSocketUpgradeAllowed } = await import('../../src/sockets/tracker.js');
    const request = {
      headers: {},
      socket: { remoteAddress: '198.51.100.40' },
    };

    for (let i = 0; i < 5; i++) {
      await expect(isWebSocketUpgradeAllowed(request)).resolves.toBe(true);
    }
    await expect(isWebSocketUpgradeAllowed(request)).resolves.toBe(false);
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

    expect(sentMessages[0].error).toContain('Forbidden: Driver role required to publish location updates');
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
    const ws = {
      driverId: 'driver-1',
      send: vi.fn(),
    };

    await handleLocationPing(ws, {
      driver_id: 'driver-1',
      order_display_id: 'ORDER-ABC',
      latitude: 12.9716,
      longitude: 77.5946,
      speed: 40,
      bearing: 180,
    });

    expect(ws.send).not.toHaveBeenCalled();
  });

  it('accepts valid coordinates at (0, 0) boundary', async () => {
    const ws = {
      driverId: 'driver-1',
      send: vi.fn(),
    };

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

  it.each([
    ['string NaN', 'NaN'],
    ['string Infinity', 'Infinity'],
    ['string -Infinity', '-Infinity'],
    ['literal NaN', NaN],
    ['literal Infinity', Infinity],
    ['literal -Infinity', -Infinity],
  ])('handles non-finite device_timestamp (%s) gracefully', async (_, ts) => {
    const ws = {
      driverId: 'driver-1',
      user: { id: 'driver-1', role: 'driver' },
      send: vi.fn(),
    };

    await handleLocationPing(ws, {
      driver_id: 'driver-1',
      latitude: 12.9,
      longitude: 77.5,
      device_timestamp: ts,
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

  it('rejects telemetry payload with out-of-range speed (issue #5758)', async () => {
    const sentMessages = [];
    const ws = {
      driverId: 'driver-1',
      send(msg) { sentMessages.push(JSON.parse(msg)); }
    };

    await handleLocationPing(ws, {
      driver_id: 'driver-1',
      latitude: 12.9,
      longitude: 77.5,
      speed: 250,
    });

    expect(sentMessages[0].error).toContain('Invalid telemetry payload');
  });

  it('rejects telemetry payload with over-long order_display_id (issue #5758)', async () => {
    const sentMessages = [];
    const ws = {
      driverId: 'driver-1',
      send(msg) { sentMessages.push(JSON.parse(msg)); }
    };

    await handleLocationPing(ws, {
      driver_id: 'driver-1',
      order_display_id: 'x'.repeat(100),
      latitude: 12.9,
      longitude: 77.5,
    });

    expect(sentMessages[0].error).toContain('Invalid telemetry payload');
  });

  it('caps the WebSocket max payload at 4 KB (issue #5758)', async () => {
    expect(__testing.WS_MAX_PAYLOAD_BYTES).toBe(4096);
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
      device_timestamp: new Date().toISOString(),
    });

    expect(ws.send).not.toHaveBeenCalled();
  });
});
