import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const { handleLocationPing, handleTrackingMessage, handleSubscribe, __testing } = await import('../../src/sockets/tracker.js');

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
