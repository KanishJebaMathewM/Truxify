import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InMemoryHub, hubPublisher } from './helpers/inMemoryPubSub.js';

// Mutable Redis mock so individual tests can flip sequence / rate-limit /
// subscription persistence behaviour on and off.
const db = vi.hoisted(() => ({ redis: null }));

vi.mock('../src/config/db.js', () => ({
  get mongoDb() { return null; },
  get redisClient() { return db.redis; },
  get firebaseAdmin() { return null; },
  get supabase() { return null; },
}));

vi.mock('../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const {
  handleLocationPing,
  handleTrackingMessage,
  handleSubscribe,
  closeWebSocketServer,
  __testing,
} = await import('../src/sockets/tracker.js');

const { createLocationEventBus } = await import('../src/sockets/locationEventBus.js');

const CHANNEL = 'test:tracking:locations';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeWs(id, { role = 'customer', readyState = 1 } = {}) {
  return {
    socketId: id,
    driverId: id,
    user: { id, role },
    send: vi.fn(),
    close: vi.fn(),
    readyState,
    authenticated: true,
    subscriptionTargets: new Set(),
  };
}

function subscribe(map, ws, targetId) {
  if (!map.has(targetId)) map.set(targetId, new Set());
  map.get(targetId).add(ws);
}

function makeOrderRepo() {
  return {
    findOrderByAnyId: vi.fn(async () => ({
      data: {
        id: 'uuid-order-1',
        order_display_id: 'OD-1',
        driver_id: 'D-1',
      },
    })),
  };
}

/**
 * Create a "replica": a location event bus bound to its own in-memory
 * subscription registry and connected to the shared hub. Mirrors what each API
 * process does with its own `trackingSubscriptions` + subscriber connection.
 */
function createReplica(hub, instanceId, subscriptionMap) {
  const bus = createLocationEventBus({
    publisher: hubPublisher(hub),
    subscriberFactory: () => hub.createSubscriber(),
    channel: CHANNEL,
    instanceId,
  });
  bus.init();
  bus.subscribe(__testing.createLocationEventHandler(bus, subscriptionMap));
  return bus;
}

function makeFakeRedis(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    status: 'ready',
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async set(key, value, ..._args) { store.set(key, String(value)); return 'OK'; },
    async del(key) { store.delete(key); return 1; },
    async incr(key) {
      const next = (parseInt(store.get(key), 10) || 0) + 1;
      store.set(key, String(next));
      return next;
    },
    async expire() { return 1; },
    async publish() { return 0; },
    async quit() {},
  };
}

async function ping(ws, overrides = {}) {
  await handleLocationPing(ws, {
    orderId: 'uuid-order-1',
    lat: 19.076,
    lng: 72.877,
    speed: 40,
    bearing: 90,
    ...overrides,
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('distributed location fan-out (multi-replica)', () => {
  let hub;
  let mapA;
  let mapB;
  let busA;
  let busB;
  const buses = [];

  function setupTwoReplicas() {
    hub = new InMemoryHub();
    mapA = new Map();
    mapB = new Map();
    busA = createReplica(hub, 'instance-A', mapA);
    busB = createReplica(hub, 'instance-B', mapB);
    buses.push(busA, busB);
    // Replica A is "this process" — handleLocationPing publishes via it and
    // delivers to mapA.
    __testing.setTrackingSubscriptions(mapA);
    __testing.setLocationEventBus(busA);
    return { hub, mapA, mapB, busA, busB };
  }

  beforeEach(() => {
    __testing.setOrderRepository(makeOrderRepo());
    __testing.setTrackingSubscriptions(new Map());
    __testing.setLocationEventBus(null);
    db.redis = null;
  });

  afterEach(async () => {
    for (const bus of buses.splice(0)) {
      await bus.close();
    }
    __testing.setLocationEventBus(null);
    await closeWebSocketServer();
  });

  it('CASE 1 — single instance: driver and customer on the same replica; customer receives exactly one update', async () => {
    setupTwoReplicas();
    const customer = makeWs('ws-A-cust');
    subscribe(mapA, customer, 'OD-1');

    const driver = makeWs('D-1', { role: 'driver' });
    await ping(driver);

    expect(customer.send).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(customer.send.mock.calls[0][0]);
    expect(payload.event).toBe('location_update');
    expect(payload.data.latitude).toBe(19.076);
    expect(payload.data.longitude).toBe(72.877);
    expect(payload.data.driver_id).toBe('D-1');
    expect(payload.data.order_display_id).toBe('OD-1');
    expect(busA.getMetrics().delivered).toBe(1);
  });

  it('CASE 2 — two instances: driver on replica A, customer on replica B; customer receives exactly one update', async () => {
    setupTwoReplicas();
    const customerB = makeWs('ws-B-cust');
    subscribe(mapB, customerB, 'OD-1');

    const driver = makeWs('D-1', { role: 'driver' });
    await ping(driver);

    expect(customerB.send).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(customerB.send.mock.calls[0][0]);
    expect(payload.data.order_display_id).toBe('OD-1');
    // The remote replica must not deliver to the publishing replica's map.
    expect(busB.getMetrics().received).toBe(1);
    expect(busB.getMetrics().delivered).toBe(1);
  });

  it('CASE 3 — multiple customers: only subscribers of the relevant order receive the event', async () => {
    setupTwoReplicas();
    const customerOD1 = makeWs('ws-B-od1');
    const customerOD2 = makeWs('ws-B-od2');
    subscribe(mapB, customerOD1, 'OD-1');
    subscribe(mapB, customerOD2, 'OD-2');

    const driver = makeWs('D-1', { role: 'driver' });
    await ping(driver);

    expect(customerOD1.send).toHaveBeenCalledTimes(1);
    expect(customerOD2.send).not.toHaveBeenCalled();
  });

  it('CASE 4 — driver subscribers still receive their own updates on a remote replica', async () => {
    setupTwoReplicas();
    // A dashboard/device on replica B subscribed to driver D-1.
    const driverFollower = makeWs('ws-B-follower');
    subscribe(mapB, driverFollower, 'D-1');

    const driver = makeWs('D-1', { role: 'driver' });
    await ping(driver);

    expect(driverFollower.send).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(driverFollower.send.mock.calls[0][0]);
    expect(payload.data.driver_id).toBe('D-1');
  });

  it('CASE 4b — driver subscribed to their own telemetry receives it exactly once (self-subscribe)', async () => {
    setupTwoReplicas();
    const driver = makeWs('D-1', { role: 'driver' });
    // handleSubscribe uses the current module-level registry (mapA).
    await handleSubscribe(driver, { driver_id: 'D-1' });
    expect(mapA.get('D-1').has(driver)).toBe(true);

    await ping(driver);

    // Delivered once by the direct local broadcast; the loopback Pub/Sub event
    // is skipped because it originates from this instance. (The subscribe ack
    // is the only other message the driver socket receives.)
    const sendArgs = driver.send.mock.calls.filter(([msg]) => msg.includes('location_update'));
    expect(sendArgs).toHaveLength(1);
  });

  it('CASE 5 — duplicate prevention: a client subscribed to both order and driver receives exactly one update', async () => {
    setupTwoReplicas();
    const dual = makeWs('ws-B-dual');
    subscribe(mapB, dual, 'OD-1');
    subscribe(mapB, dual, 'D-1');

    const driver = makeWs('D-1', { role: 'driver' });
    await ping(driver);

    expect(dual.send).toHaveBeenCalledTimes(1);
    expect(busB.getMetrics().delivered).toBe(1);
  });

  it('CASE 6 — stale/out-of-order location is rejected before publication', async () => {
    setupTwoReplicas();
    const customer = makeWs('ws-B-cust');
    subscribe(mapB, customer, 'OD-1');

    // Seed the sequence key with a timestamp in the future so the ingress
    // sequence gate drops the update before it can be persisted or published.
    db.redis = makeFakeRedis({ 'driver:sequence:D-1': String(Date.now() + 100_000) });

    const driver = makeWs('D-1', { role: 'driver' });
    await ping(driver);

    expect(customer.send).not.toHaveBeenCalled();
    expect(busA.getMetrics().published).toBe(0);
    expect(busB.getMetrics().received).toBe(0);
  });

  it('CASE 7 — rate-limited location requests are never published', async () => {
    setupTwoReplicas();
    const customer = makeWs('ws-B-cust');
    subscribe(mapB, customer, 'OD-1');

    const driver = makeWs('D-1', { role: 'driver' });
    const message = JSON.stringify({
      event: 'location_ping',
      data: { orderId: 'uuid-order-1', lat: 19.076, lng: 72.877 },
    });

    for (let i = 0; i < 11; i++) {
      await handleTrackingMessage(driver, message);
    }

    // 10 pings processed (each published once), 11th dropped by the ingress
    // rate limiter before processing.
    expect(busA.getMetrics().published).toBe(10);
    expect(customer.send).toHaveBeenCalledTimes(10);
  });

  it('CASE 8 — subscriber disconnect: process survives, local + remote delivery continues, subscription restores', async () => {
    setupTwoReplicas();
    const customerA = makeWs('ws-A-cust');
    const customerB = makeWs('ws-B-cust');
    subscribe(mapA, customerA, 'OD-1');
    subscribe(mapB, customerB, 'OD-1');

    const subA = hub.subscribers
      .values()
      .next().value; // busA's subscriber is the first created

    // Simulate the subscriber connection dropping.
    subA._dropConnection();
    expect(busA.getState().ready).toBe(false);

    // A location ping still delivers locally on A and remotely on B (the
    // publisher is unaffected by the subscriber drop).
    const driver = makeWs('D-1', { role: 'driver' });
    await ping(driver);
    expect(customerA.send).toHaveBeenCalledTimes(1);
    expect(customerB.send).toHaveBeenCalledTimes(1);

    // No crash from subscriber-side errors while down.
    expect(() => subA._emit('error', new Error('ECONNRESET'))).not.toThrow();

    // Reconnect: ioredis resubscribes; the bus reports ready again.
    subA._reconnect();
    expect(busA.getState().subscribed).toBe(true);
    expect(busA.getState().ready).toBe(true);
  });

  it('CASE 9 — malformed Pub/Sub events are rejected and never reach clients', async () => {
    setupTwoReplicas();
    const customerB = makeWs('ws-B-cust');
    subscribe(mapB, customerB, 'OD-1');

    const subB = [...hub.subscribers][1]; // busB's subscriber

    expect(() => {
      subB._deliverMessage(CHANNEL, '{not valid json');
      subB._deliverMessage(CHANNEL, JSON.stringify({ type: 'evil_event', v: 1 }));
      subB._deliverMessage(CHANNEL, JSON.stringify({
        type: 'location_update',
        v: 1,
        sourceInstanceId: 'instance-B',
        driverId: 'D-1',
        sequence: 1,
        location: { lat: 999, lng: 0 },
      }));
    }).not.toThrow();

    expect(customerB.send).not.toHaveBeenCalled();
    expect(busB.getMetrics().droppedMalformed).toBe(3);
  });

  it('CASE 10 — disconnected clients are removed and closed sockets receive nothing', async () => {
    setupTwoReplicas();
    const openCustomer = makeWs('ws-B-open');
    const closedCustomer = makeWs('ws-B-closed');
    subscribe(mapB, openCustomer, 'OD-1');
    subscribe(mapB, closedCustomer, 'OD-1');

    // Simulate disconnect: remove from the local registry and mark closed.
    mapB.get('OD-1').delete(closedCustomer);
    closedCustomer.readyState = 3;

    const driver = makeWs('D-1', { role: 'driver' });
    await ping(driver);

    expect(closedCustomer.send).not.toHaveBeenCalled();
    expect(openCustomer.send).toHaveBeenCalledTimes(1);
    expect(busB.getMetrics().delivered).toBe(1);
  });

  it('metrics — events with no eligible local subscriber are counted, not delivered', async () => {
    setupTwoReplicas();
    const driver = makeWs('D-1', { role: 'driver' });
    await ping(driver);
    // No subscriber on replica B for this order/driver.
    expect(busB.getMetrics().delivered).toBe(0);
    expect(busB.getMetrics().droppedNoSubscribers).toBe(1);
  });

  it('one location event produces exactly one delivery per eligible client across both replicas', async () => {
    setupTwoReplicas();
    const customerA1 = makeWs('ws-A-1');
    const customerA2 = makeWs('ws-A-2');
    const customerB1 = makeWs('ws-B-1');
    subscribe(mapA, customerA1, 'OD-1');
    subscribe(mapA, customerA2, 'OD-1');
    subscribe(mapB, customerB1, 'OD-1');

    const driver = makeWs('D-1', { role: 'driver' });
    await ping(driver);

    expect(customerA1.send).toHaveBeenCalledTimes(1);
    expect(customerA2.send).toHaveBeenCalledTimes(1);
    expect(customerB1.send).toHaveBeenCalledTimes(1);
    expect(busA.getMetrics().delivered).toBe(2);
    expect(busB.getMetrics().delivered).toBe(1);
  });
});
