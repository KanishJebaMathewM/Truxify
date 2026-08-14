import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FakeSubscriber, InMemoryHub, hubPublisher } from './helpers/inMemoryPubSub.js';

vi.mock('../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { createLocationEventBus, validateInternalEvent } = await import('../src/sockets/locationEventBus.js');

const CHANNEL = 'test:tracking:locations';

function makeValidEvent(overrides = {}) {
  return {
    type: 'location_update',
    v: 1,
    sourceInstanceId: 'instance-A',
    driverId: 'driver-1',
    orderDisplayId: 'OD-1',
    sequence: 1234567890000,
    timestamp: '2026-08-08T00:00:00.000Z',
    location: { lat: 19.076, lng: 72.877, speed: 40, bearing: 90 },
    ...overrides,
  };
}

function createBus({ publisher, hub, instanceId = 'instance-A' } = {}) {
  const transport = hub || new InMemoryHub();
  const fakeSub = new FakeSubscriber(transport);
  transport.subscribers.add(fakeSub);
  const bus = createLocationEventBus({
    publisher: publisher || hubPublisher(transport),
    subscriberFactory: () => fakeSub,
    channel: CHANNEL,
    instanceId,
  });
  bus.init();
  return { bus, fakeSub, hub: transport };
}

describe('locationEventBus — validateInternalEvent', () => {
  it('accepts a well-formed internal event', () => {
    expect(validateInternalEvent(makeValidEvent())).toBe(null);
  });

  it('accepts an event without optional fields', () => {
    const event = makeValidEvent({ orderDisplayId: null });
    delete event.location.speed;
    delete event.location.bearing;
    delete event.timestamp;
    expect(validateInternalEvent(event)).toBe(null);
  });

  it.each([
    ['non-object', 'not-json'],
    ['null', null],
    ['array', [1, 2, 3]],
    ['unknown type', makeValidEvent({ type: 'other_event' })],
    ['unsupported version', makeValidEvent({ v: 2 })],
    ['missing driverId', makeValidEvent({ driverId: undefined })],
    ['non-string driverId', makeValidEvent({ driverId: 42 })],
    ['too long driverId', makeValidEvent({ driverId: 'x'.repeat(65) })],
    ['missing sourceInstanceId', makeValidEvent({ sourceInstanceId: undefined })],
    ['negative sequence', makeValidEvent({ sequence: -1 })],
    ['non-numeric sequence', makeValidEvent({ sequence: 'abc' })],
    ['missing location', makeValidEvent({ location: undefined })],
    ['lat out of range', makeValidEvent({ location: { lat: 91, lng: 0 } })],
    ['lng out of range', makeValidEvent({ location: { lat: 0, lng: 181 } })],
    ['non-numeric lat', makeValidEvent({ location: { lat: 'north', lng: 0 } })],
    ['NaN lat', makeValidEvent({ location: { lat: NaN, lng: 0 } })],
    ['speed out of range', makeValidEvent({ location: { lat: 0, lng: 0, speed: 201 } })],
    ['bearing out of range', makeValidEvent({ location: { lat: 0, lng: 0, bearing: 361 } })],
    ['invalid orderDisplayId type', makeValidEvent({ orderDisplayId: 123 })],
    ['invalid timestamp type', makeValidEvent({ timestamp: 12345 })],
  ])('rejects %s', (_label, event) => {
    expect(validateInternalEvent(event)).not.toBe(null);
  });
});

describe('locationEventBus — publish', () => {
  it('returns false and never publishes when no publisher is configured', async () => {
    const bus = createLocationEventBus({ channel: CHANNEL, instanceId: 'no-redis' });
    bus.init();
    await expect(bus.publish(makeValidEvent())).resolves.toBe(false);
    expect(bus.getState().enabled).toBe(false);
    expect(bus.getState().ready).toBe(false);
  });

  it('publishes a serialized event to the channel and counts it', async () => {
    const { bus, hub } = createBus();
    const event = makeValidEvent();
    await expect(bus.publish(event)).resolves.toBe(true);
    expect(hub.published).toHaveLength(1);
    expect(hub.published[0].channel).toBe(CHANNEL);
    expect(JSON.parse(hub.published[0].message)).toMatchObject({
      type: 'location_update',
      driverId: 'driver-1',
    });
    expect(bus.getMetrics().published).toBe(1);
  });

  it('records publish failures and never throws when the publisher rejects', async () => {
    const failingPublisher = { publish: vi.fn().mockRejectedValue(new Error('redis down')) };
    const { bus } = createBus({ publisher: failingPublisher });
    await expect(bus.publish(makeValidEvent())).resolves.toBe(false);
    expect(bus.getMetrics().publishFailures).toBe(1);
  });

  it('rejects oversized events without publishing', async () => {
    const { bus, hub } = createBus();
    const event = makeValidEvent({ driverId: 'x'.repeat(3000) });
    await expect(bus.publish(event)).resolves.toBe(false);
    expect(hub.published).toHaveLength(0);
    expect(bus.getMetrics().publishFailures).toBe(1);
  });
});

describe('locationEventBus — subscribe + message handling', () => {
  let bus, fakeSub, hub;
  beforeEach(() => {
    ({ bus, fakeSub, hub } = createBus());
  });

  it('dispatches valid events to registered handlers exactly once', async () => {
    const handler = vi.fn();
    bus.subscribe(handler);
    const event = makeValidEvent();
    fakeSub._deliverMessage(CHANNEL, JSON.stringify(event));
    await Promise.resolve();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(event);
    expect(bus.getMetrics().received).toBe(1);
  });

  it('drops unparseable messages without invoking handlers', async () => {
    const handler = vi.fn();
    bus.subscribe(handler);
    fakeSub._deliverMessage(CHANNEL, '{not json');
    await Promise.resolve();
    expect(handler).not.toHaveBeenCalled();
    expect(bus.getMetrics().droppedMalformed).toBe(1);
  });

  it('drops schema-invalid messages without invoking handlers', async () => {
    const handler = vi.fn();
    bus.subscribe(handler);
    fakeSub._deliverMessage(CHANNEL, JSON.stringify(makeValidEvent({ location: { lat: 999, lng: 0 } })));
    fakeSub._deliverMessage(CHANNEL, JSON.stringify(makeValidEvent({ type: 'bogus' })));
    await Promise.resolve();
    expect(handler).not.toHaveBeenCalled();
    expect(bus.getMetrics().droppedMalformed).toBe(2);
  });

  it('ignores messages on other channels', async () => {
    const handler = vi.fn();
    bus.subscribe(handler);
    fakeSub._deliverMessage('other:channel', JSON.stringify(makeValidEvent()));
    await Promise.resolve();
    expect(handler).not.toHaveBeenCalled();
    expect(bus.getMetrics().received).toBe(0);
  });

  it('continues when a handler throws (no crash, other handlers still run)', async () => {
    const badHandler = vi.fn(() => { throw new Error('boom'); });
    const goodHandler = vi.fn();
    bus.subscribe(badHandler);
    bus.subscribe(goodHandler);
    expect(() => fakeSub._deliverMessage(CHANNEL, JSON.stringify(makeValidEvent()))).not.toThrow();
    await Promise.resolve();
    expect(badHandler).toHaveBeenCalledTimes(1);
    expect(goodHandler).toHaveBeenCalledTimes(1);
  });

  it('survives rejected async handlers', async () => {
    const badHandler = vi.fn(() => Promise.reject(new Error('async boom')));
    const goodHandler = vi.fn();
    bus.subscribe(badHandler);
    bus.subscribe(goodHandler);
    fakeSub._deliverMessage(CHANNEL, JSON.stringify(makeValidEvent()));
    await new Promise((r) => setTimeout(r, 10));
    expect(goodHandler).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe removes the handler', async () => {
    const handler = vi.fn();
    const unsubscribe = bus.subscribe(handler);
    unsubscribe();
    fakeSub._deliverMessage(CHANNEL, JSON.stringify(makeValidEvent()));
    await Promise.resolve();
    expect(handler).not.toHaveBeenCalled();
  });

  it('records delivery and no-subscriber metrics', () => {
    bus.recordDelivery(3);
    bus.recordNoSubscribers();
    const metrics = bus.getMetrics();
    expect(metrics.delivered).toBe(3);
    expect(metrics.droppedNoSubscribers).toBe(1);
  });
});

describe('locationEventBus — lifecycle and reconnect', () => {
  it('reports readiness once subscribed and loses it on close', async () => {
    const { bus, fakeSub } = createBus();
    expect(bus.getState().subscribed).toBe(true);
    expect(bus.getState().ready).toBe(true);
    expect(bus.getState().enabled).toBe(true);

    fakeSub._dropConnection();
    expect(bus.getState().subscribed).toBe(false);
    expect(bus.getState().ready).toBe(false);

    fakeSub._reconnect();
    expect(bus.getState().subscribed).toBe(true);
    expect(bus.getState().ready).toBe(true);
  });

  it('keeps the process alive when the subscriber errors', async () => {
    const { fakeSub } = createBus();
    expect(() => fakeSub._emit('error', new Error('redis connection error'))).not.toThrow();
    expect(() => fakeSub._emit('error', new Error('ECONNRESET'))).not.toThrow();
  });

  it('close unsubscribes, quits the connection and stops future publishes', async () => {
    const { bus, fakeSub } = createBus();
    await bus.close();
    expect(fakeSub.subscribedChannels.size).toBe(0);
    expect(fakeSub.status).toBe('end');
    expect(bus.getState().enabled).toBe(false);
    await expect(bus.publish(makeValidEvent())).resolves.toBe(false);
  });

  it('close is idempotent', async () => {
    const { bus } = createBus();
    await bus.close();
    await expect(bus.close()).resolves.toBeUndefined();
  });
});

describe('locationEventBus — instance identity', () => {
  it('exposes the configured instance id', () => {
    const { bus } = createBus({ instanceId: 'instance-X' });
    expect(bus.getInstanceId()).toBe('instance-X');
    expect(bus.getState().instanceId).toBe('instance-X');
  });
});
