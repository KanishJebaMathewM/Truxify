import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sio = vi.hoisted(() => {
  const mkNS = () => {
    const ns = {
      use: vi.fn(),
      on: vi.fn(),
      _to: null,
      emit: vi.fn(),
      to(room) { this._to = room; return this; },
    };
    return ns;
  };
  const instance = {
    ns: new Map(),
    close: vi.fn(),
    of(name) {
      if (!this.ns.has(name)) this.ns.set(name, mkNS());
      return this.ns.get(name);
    },
  };
  return { Server: function MockServer() { return instance }, instance };
});

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(),
}));

const telemetryBufferMock = vi.hoisted(() => ({
  default: { enqueue: vi.fn(), readLatestPoint: vi.fn() },
}));

const supabaseMock = vi.hoisted(() => {
  const orders = [
    { id: 'order-uuid-1', order_display_id: 'b1', customer_id: 'cust-1', driver_id: 'd1' },
  ];
  return {
    from(table) {
      const filters = [];
      return {
        select() { return this; },
        eq(col, value) { filters.push({ col, value }); return this; },
        async maybeSingle() {
          const row = (table === 'orders' ? orders : []).find((r) =>
            filters.every(({ col, value }) => r[col] === value)
          );
          return { data: row ?? null, error: null };
        },
      };
    },
  };
});

vi.mock('socket.io', () => ({ Server: sio.Server }));
vi.mock('jsonwebtoken', () => ({ default: { verify: vi.fn(), sign: vi.fn() } }));
vi.mock('../../../src/middleware/logger.js', () => ({ default: mockLogger }));
vi.mock('../../../src/models/GpsLog.js', () => ({ GpsLog: { create: vi.fn() } }));
vi.mock('../../../src/config/db.js', () => ({ supabase: supabaseMock }));
vi.mock('../../../src/sockets/telemetryBuffer.js', () => telemetryBufferMock);

const { initLocationServer, closeLocationServer } = await import('../../../src/sockets/locationServer.js');

function fakeSocket(overrides = {}) {
  return {
    id: 'sock-1',
    data: { driverId: 'd1', bookingId: 'b1', orderId: 'order-uuid-1' },
    join: vi.fn(),
    on: vi.fn(),
    emit: vi.fn(),
    disconnect: vi.fn(),
    ...overrides,
  };
}

function getNs(name) {
  return sio.instance.ns.get(name);
}

function getConnectionHandler(nsName) {
  const call = getNs(nsName).on.mock.calls.find(([event]) => event === 'connection');
  return call?.[1];
}

function getHandler(socket, eventName) {
  const call = socket.on.mock.calls.find(([event]) => event === eventName);
  return call?.[1];
}

describe('locationServer — broadcast decoupled from buffered telemetry persistence', () => {
  beforeEach(() => {
    initLocationServer({});
  });

  afterEach(async () => {
    telemetryBufferMock.default.enqueue.mockReset();
    telemetryBufferMock.default.readLatestPoint.mockReset();
    mockLogger.error.mockClear();
    sio.instance.ns.forEach((ns) => {
      ns.emit.mockClear();
      ns._to = null;
    });
    await closeLocationServer();
  });

  it('buffers a GPS ping into the telemetry pipeline and broadcasts to the booking room', () => {
    const socket = fakeSocket();
    getConnectionHandler('/driver')(socket);
    const onUpdate = getHandler(socket, 'location_update');

    onUpdate({ lat: 19.07, lng: 72.87, speed: 42, heading: 90, timestamp: '2026-01-01T00:00:00Z' });

    // Persistence record is pushed into the shared buffer — synchronous.
    expect(telemetryBufferMock.default.enqueue).toHaveBeenCalledTimes(1);
    const record = telemetryBufferMock.default.enqueue.mock.calls[0][0];
    expect(record).toMatchObject({
      driver_id: 'd1',
      order_id: 'order-uuid-1',
      order_display_id: 'b1',
      lat: 19.07,
      lng: 72.87,
      speed_kmh: 42,
      bearing_deg: 90,
      location: { type: 'Point', coordinates: [72.87, 19.07] },
    });
    expect(record.timestamp).toBeInstanceOf(Date);
    expect(record.pinged_at).toBeInstanceOf(Date);
    expect(record.buffered_at).toBeInstanceOf(Date);

    // Broadcast is independent of persistence.
    const customerNs = getNs('/customer');
    expect(customerNs.emit).toHaveBeenCalledWith('driver_location', {
      lat: 19.07,
      lng: 72.87,
      speed: 42,
      heading: 90,
      timestamp: '2026-01-01T00:00:00.000Z',
      bookingId: 'b1',
    });
    expect(customerNs._to).toBe('booking:b1');
  });

  it('fail-open: a failing telemetry buffer does NOT block the broadcast', () => {
    const socket = fakeSocket();
    getConnectionHandler('/driver')(socket);
    const onUpdate = getHandler(socket, 'location_update');

    telemetryBufferMock.default.enqueue.mockImplementationOnce(() => {
      throw new Error('MongoDB down');
    });
    onUpdate({ lat: 1, lng: 2 });

    const customerNs = getNs('/customer');
    expect(customerNs.emit).toHaveBeenCalledWith(
      'driver_location',
      expect.objectContaining({ lat: 1, lng: 2, bookingId: 'b1' })
    );
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ driverId: 'd1' }),
      expect.stringContaining('broadcast continues')
    );
  });

  it('rejects invalid coordinates without enqueueing or broadcasting', () => {
    const socket = fakeSocket();
    getConnectionHandler('/driver')(socket);
    const onUpdate = getHandler(socket, 'location_update');

    onUpdate({ lat: 91, lng: 0 });

    expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Invalid GPS coordinates' });
    expect(telemetryBufferMock.default.enqueue).not.toHaveBeenCalled();
    expect(getNs('/customer').emit).not.toHaveBeenCalled();
  });

  it('subscribe_booking reads the last known point from the telemetry buffer', async () => {
    const socket = fakeSocket({ data: { customerId: 'cust-1' } });
    getConnectionHandler('/customer')(socket);
    const onSubscribe = getHandler(socket, 'subscribe_booking');

    telemetryBufferMock.default.readLatestPoint.mockResolvedValueOnce({
      lat: 19.07,
      lng: 72.87,
      speed: 42,
      heading: 90,
      timestamp: new Date('2026-01-01T00:00:00Z'),
    });

    await onSubscribe({ bookingId: 'b1' });

    expect(telemetryBufferMock.default.readLatestPoint).toHaveBeenCalledWith('b1');
    expect(socket.join).toHaveBeenCalledWith('booking:b1');
    expect(socket.emit).toHaveBeenCalledWith(
      'driver_location',
      expect.objectContaining({ lat: 19.07, lng: 72.87, bookingId: 'b1' })
    );
    expect(socket.emit).toHaveBeenCalledWith('subscribed', { bookingId: 'b1' });
  });

  it('subscribe_booking rejects a booking the customer does not own', async () => {
    const socket = fakeSocket({ data: { customerId: 'cust-other' } });
    getConnectionHandler('/customer')(socket);
    const onSubscribe = getHandler(socket, 'subscribe_booking');

    await onSubscribe({ bookingId: 'b1' });

    expect(socket.emit).toHaveBeenCalledWith('error', {
      message: 'Unauthorised: You do not own this booking',
    });
    expect(socket.join).not.toHaveBeenCalled();
    expect(telemetryBufferMock.default.readLatestPoint).not.toHaveBeenCalled();
  });
});
