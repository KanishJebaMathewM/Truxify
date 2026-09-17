import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FakeSubscriber, InMemoryHub, hubPublisher } from '../helpers/inMemoryPubSub.js';
import { createLocationEventBus, validateInternalEvent } from '../../src/sockets/locationEventBus.js';
import logger from '../../src/middleware/logger.js';

vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const TEST_CHANNEL = 'truxify:test:tracking:locations';

function createSampleEvent(overrides = {}) {
  return {
    type: 'location_update',
    v: 1,
    sourceInstanceId: 'instance-replica-1',
    driverId: 'driver-xyz-987',
    orderDisplayId: '#TRX-2026-001',
    sequence: 10001,
    timestamp: '2026-09-17T09:30:00.000Z',
    location: {
      lat: 19.0760,
      lng: 72.8777,
      speed: 45.5,
      bearing: 180.0,
    },
    ...overrides,
  };
}

function setupTestBus(options = {}) {
  const hub = options.hub || new InMemoryHub();
  const fakeSubscriber = options.fakeSubscriber || new FakeSubscriber(hub);
  hub.subscribers.add(fakeSubscriber);

  const bus = createLocationEventBus({
    channel: options.channel || TEST_CHANNEL,
    instanceId: options.instanceId || 'instance-replica-1',
    publisher: options.publisher || hubPublisher(hub),
    subscriberFactory: options.subscriberFactory || (() => fakeSubscriber),
  });

  bus.init();
  return { bus, hub, fakeSubscriber };
}

describe('locationEventBus Unit Tests (backend/api/src/sockets/locationEventBus.js)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Message Parsing with Valid JSON and Schema Validation', () => {
    it('successfully parses and dispatches a valid JSON message to subscribers', async () => {
      const { bus, fakeSubscriber } = setupTestBus();
      const handler = vi.fn();
      bus.subscribe(handler);

      const validEvent = createSampleEvent();
      const rawPayload = JSON.stringify(validEvent);

      fakeSubscriber._deliverMessage(TEST_CHANNEL, rawPayload);
      await Promise.resolve();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(validEvent);
      expect(bus.getMetrics().received).toBe(1);
      expect(bus.getMetrics().droppedMalformed).toBe(0);
    });

    it('parses minimal valid events with optional fields omitted', async () => {
      const { bus, fakeSubscriber } = setupTestBus();
      const handler = vi.fn();
      bus.subscribe(handler);

      const minimalEvent = {
        type: 'location_update',
        v: 1,
        driverId: 'drv-min',
        sourceInstanceId: 'inst-min',
        sequence: 1,
        location: { lat: 28.6139, lng: 77.2090 },
      };

      fakeSubscriber._deliverMessage(TEST_CHANNEL, JSON.stringify(minimalEvent));
      await Promise.resolve();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(minimalEvent);
      expect(validateInternalEvent(minimalEvent)).toBeNull();
    });

    it('ignores messages delivered on channels other than the configured channel', async () => {
      const { bus, fakeSubscriber } = setupTestBus();
      const handler = vi.fn();
      bus.subscribe(handler);

      fakeSubscriber._deliverMessage('different:channel', JSON.stringify(createSampleEvent()));
      await Promise.resolve();

      expect(handler).not.toHaveBeenCalled();
      expect(bus.getMetrics().received).toBe(0);
    });
  });

  describe('Handler Registration and Cleanup', () => {
    it('registers multiple handlers and delivers received events to all of them', async () => {
      const { bus, fakeSubscriber } = setupTestBus();
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const handler3 = vi.fn();

      bus.subscribe(handler1);
      bus.subscribe(handler2);
      bus.subscribe(handler3);

      fakeSubscriber._deliverMessage(TEST_CHANNEL, JSON.stringify(createSampleEvent()));
      await Promise.resolve();

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
      expect(handler3).toHaveBeenCalledTimes(1);
    });

    it('returns an unsubscribe function that safely removes the handler', async () => {
      const { bus, fakeSubscriber } = setupTestBus();
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      const unsubscribe1 = bus.subscribe(handler1);
      bus.subscribe(handler2);

      // Trigger first message with both handlers active
      fakeSubscriber._deliverMessage(TEST_CHANNEL, JSON.stringify(createSampleEvent({ sequence: 1 })));
      await Promise.resolve();

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);

      // Unsubscribe handler1
      unsubscribe1();

      // Trigger second message
      fakeSubscriber._deliverMessage(TEST_CHANNEL, JSON.stringify(createSampleEvent({ sequence: 2 })));
      await Promise.resolve();

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(2);
    });

    it('throws TypeError when a non-function is passed to subscribe', () => {
      const { bus } = setupTestBus();
      expect(() => bus.subscribe(null)).toThrow(TypeError);
      expect(() => bus.subscribe('invalid')).toThrow(TypeError);
      expect(() => bus.subscribe(12345)).toThrow(TypeError);
      expect(() => bus.subscribe({})).toThrow(TypeError);
    });

    it('clears all handlers upon closing the event bus', async () => {
      const { bus, fakeSubscriber } = setupTestBus();
      const handler = vi.fn();
      bus.subscribe(handler);

      await bus.close();

      fakeSubscriber._deliverMessage(TEST_CHANNEL, JSON.stringify(createSampleEvent()));
      await Promise.resolve();

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('Handling of Malformed Messages & Schema Validation Errors', () => {
    it('drops non-JSON and unparseable messages without throwing', async () => {
      const { bus, fakeSubscriber } = setupTestBus();
      const handler = vi.fn();
      bus.subscribe(handler);

      fakeSubscriber._deliverMessage(TEST_CHANNEL, 'malformed-not-json{');
      fakeSubscriber._deliverMessage(TEST_CHANNEL, '{"incomplete":');
      await Promise.resolve();

      expect(handler).not.toHaveBeenCalled();
      expect(bus.getMetrics().received).toBe(2);
      expect(bus.getMetrics().droppedMalformed).toBe(2);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ channel: TEST_CHANNEL }),
        expect.stringContaining('[locationEventBus] Dropped unparseable Pub/Sub message.')
      );
    });

    it('drops non-object JSON payloads (numbers, strings, booleans, arrays, null)', async () => {
      const { bus, fakeSubscriber } = setupTestBus();
      const handler = vi.fn();
      bus.subscribe(handler);

      const invalidPayloads = ['12345', '"plain string"', 'true', 'null', '["array", "data"]'];

      for (const payload of invalidPayloads) {
        fakeSubscriber._deliverMessage(TEST_CHANNEL, payload);
      }
      await Promise.resolve();

      expect(handler).not.toHaveBeenCalled();
      expect(bus.getMetrics().droppedMalformed).toBe(invalidPayloads.length);
    });

    it('validates schema requirements and catches all invalid field scenarios', () => {
      // 1. Not an object
      expect(validateInternalEvent(null)).toBe('not-an-object');
      expect(validateInternalEvent('string')).toBe('not-an-object');
      expect(validateInternalEvent([1, 2])).toBe('not-an-object');

      // 2. Event type and version
      expect(validateInternalEvent(createSampleEvent({ type: 'unknown_event' }))).toBe('unknown-type');
      expect(validateInternalEvent(createSampleEvent({ v: 2 }))).toBe('unsupported-version');

      // 3. Driver ID
      expect(validateInternalEvent(createSampleEvent({ driverId: '' }))).toBe('invalid-driverId');
      expect(validateInternalEvent(createSampleEvent({ driverId: 123 }))).toBe('invalid-driverId');
      expect(validateInternalEvent(createSampleEvent({ driverId: 'a'.repeat(65) }))).toBe('invalid-driverId');

      // 4. Source Instance ID
      expect(validateInternalEvent(createSampleEvent({ sourceInstanceId: '' }))).toBe('invalid-sourceInstanceId');
      expect(validateInternalEvent(createSampleEvent({ sourceInstanceId: null }))).toBe('invalid-sourceInstanceId');
      expect(validateInternalEvent(createSampleEvent({ sourceInstanceId: 'i'.repeat(65) }))).toBe('invalid-sourceInstanceId');

      // 5. Sequence
      expect(validateInternalEvent(createSampleEvent({ sequence: -1 }))).toBe('invalid-sequence');
      expect(validateInternalEvent(createSampleEvent({ sequence: 'invalid' }))).toBe('invalid-sequence');
      expect(validateInternalEvent(createSampleEvent({ sequence: Infinity }))).toBe('invalid-sequence');
      expect(validateInternalEvent(createSampleEvent({ sequence: NaN }))).toBe('invalid-sequence');

      // 6. Location object
      expect(validateInternalEvent(createSampleEvent({ location: null }))).toBe('invalid-location');
      expect(validateInternalEvent(createSampleEvent({ location: 'invalid' }))).toBe('invalid-location');
      expect(validateInternalEvent(createSampleEvent({ location: [] }))).toBe('invalid-location');

      // 7. Coordinates
      expect(validateInternalEvent(createSampleEvent({ location: { lat: 95.0, lng: 0 } }))).toBe('invalid-lat');
      expect(validateInternalEvent(createSampleEvent({ location: { lat: -95.0, lng: 0 } }))).toBe('invalid-lat');
      expect(validateInternalEvent(createSampleEvent({ location: { lat: 'north', lng: 0 } }))).toBe('invalid-lat');
      expect(validateInternalEvent(createSampleEvent({ location: { lat: NaN, lng: 0 } }))).toBe('invalid-lat');

      expect(validateInternalEvent(createSampleEvent({ location: { lat: 0, lng: 185.0 } }))).toBe('invalid-lng');
      expect(validateInternalEvent(createSampleEvent({ location: { lat: 0, lng: -185.0 } }))).toBe('invalid-lng');
      expect(validateInternalEvent(createSampleEvent({ location: { lat: 0, lng: 'east' } }))).toBe('invalid-lng');
      expect(validateInternalEvent(createSampleEvent({ location: { lat: 0, lng: NaN } }))).toBe('invalid-lng');

      // 8. Speed and Bearing
      expect(validateInternalEvent(createSampleEvent({ location: { lat: 0, lng: 0, speed: -5 } }))).toBe('invalid-speed');
      expect(validateInternalEvent(createSampleEvent({ location: { lat: 0, lng: 0, speed: 250 } }))).toBe('invalid-speed');
      expect(validateInternalEvent(createSampleEvent({ location: { lat: 0, lng: 0, speed: 'fast' } }))).toBe('invalid-speed');

      expect(validateInternalEvent(createSampleEvent({ location: { lat: 0, lng: 0, bearing: -10 } }))).toBe('invalid-bearing');
      expect(validateInternalEvent(createSampleEvent({ location: { lat: 0, lng: 0, bearing: 370 } }))).toBe('invalid-bearing');
      expect(validateInternalEvent(createSampleEvent({ location: { lat: 0, lng: 0, bearing: 'north' } }))).toBe('invalid-bearing');

      // 9. Order Display ID and Timestamp
      expect(validateInternalEvent(createSampleEvent({ orderDisplayId: '' }))).toBe('invalid-orderDisplayId');
      expect(validateInternalEvent(createSampleEvent({ orderDisplayId: 9999 }))).toBe('invalid-orderDisplayId');
      expect(validateInternalEvent(createSampleEvent({ orderDisplayId: 'x'.repeat(65) }))).toBe('invalid-orderDisplayId');

      expect(validateInternalEvent(createSampleEvent({ timestamp: 12345678 }))).toBe('invalid-timestamp');
    });

    it('drops schema-invalid events received via Pub/Sub and increments droppedMalformed metric', async () => {
      const { bus, fakeSubscriber } = setupTestBus();
      const handler = vi.fn();
      bus.subscribe(handler);

      const invalidEvent = createSampleEvent({ sequence: -99 });
      fakeSubscriber._deliverMessage(TEST_CHANNEL, JSON.stringify(invalidEvent));
      await Promise.resolve();

      expect(handler).not.toHaveBeenCalled();
      expect(bus.getMetrics().received).toBe(1);
      expect(bus.getMetrics().droppedMalformed).toBe(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'invalid-sequence' }),
        expect.stringContaining('[locationEventBus] Dropped malformed location event.')
      );
    });
  });

  describe('Metrics Tracking', () => {
    it('tracks published and publishFailures counts correctly', async () => {
      const { bus, hub } = setupTestBus();
      const initialMetrics = bus.getMetrics();
      expect(initialMetrics.published).toBe(0);
      expect(initialMetrics.publishFailures).toBe(0);

      // Successful publish
      const result1 = await bus.publish(createSampleEvent());
      expect(result1).toBe(true);
      expect(bus.getMetrics().published).toBe(1);
      expect(hub.published).toHaveLength(1);

      // Oversized event failure (> 2048 bytes)
      const oversizedEvent = createSampleEvent({ driverId: 'X'.repeat(2100) });
      const result2 = await bus.publish(oversizedEvent);
      expect(result2).toBe(false);
      expect(bus.getMetrics().publishFailures).toBe(1);

      // Circular structure JSON serialization failure
      const circularObj = {};
      circularObj.self = circularObj;
      const result3 = await bus.publish(circularObj);
      expect(result3).toBe(false);
      expect(bus.getMetrics().publishFailures).toBe(2);
    });

    it('tracks delivery and no-subscribers metrics', () => {
      const { bus } = setupTestBus();

      bus.recordDelivery(10);
      bus.recordDelivery(5);
      bus.recordNoSubscribers();
      bus.recordNoSubscribers();

      const metrics = bus.getMetrics();
      expect(metrics.delivered).toBe(15);
      expect(metrics.droppedNoSubscribers).toBe(2);
    });

    it('ensures getMetrics returns an isolated copy', () => {
      const { bus } = setupTestBus();
      const copy1 = bus.getMetrics();
      copy1.published = 999;

      const copy2 = bus.getMetrics();
      expect(copy2.published).toBe(0);
    });

    it('tracks subscriberErrors and subscriberReconnects on connection events', () => {
      const { bus, fakeSubscriber } = setupTestBus();

      fakeSubscriber._emit('error', new Error('Simulated Redis error'));
      fakeSubscriber._emit('reconnecting');
      fakeSubscriber._emit('reconnecting');

      const metrics = bus.getMetrics();
      expect(metrics.subscriberErrors).toBe(1);
      expect(metrics.subscriberReconnects).toBe(2);
    });
  });

  describe('Error Handling Paths and Resilience', () => {
    it('catches and isolates synchronous exceptions in subscriber handlers without crashing', async () => {
      const { bus, fakeSubscriber } = setupTestBus();
      const throwingHandler = vi.fn(() => {
        throw new Error('Fatal handler error');
      });
      const healthyHandler = vi.fn();

      bus.subscribe(throwingHandler);
      bus.subscribe(healthyHandler);

      expect(() => {
        fakeSubscriber._deliverMessage(TEST_CHANNEL, JSON.stringify(createSampleEvent()));
      }).not.toThrow();

      await Promise.resolve();

      expect(throwingHandler).toHaveBeenCalledTimes(1);
      expect(healthyHandler).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.stringContaining('[locationEventBus] Handler error.')
      );
    });

    it('catches and logs async rejections in subscriber handlers', async () => {
      const { bus, fakeSubscriber } = setupTestBus();
      const asyncRejectingHandler = vi.fn(() => Promise.reject(new Error('Async failure')));
      const healthyHandler = vi.fn();

      bus.subscribe(asyncRejectingHandler);
      bus.subscribe(healthyHandler);

      fakeSubscriber._deliverMessage(TEST_CHANNEL, JSON.stringify(createSampleEvent()));
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(asyncRejectingHandler).toHaveBeenCalledTimes(1);
      expect(healthyHandler).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.stringContaining('[locationEventBus] Async handler error.')
      );
    });

    it('handles publisher rejection gracefully without throwing in publish()', async () => {
      const rejectingPublisher = {
        publish: vi.fn().mockRejectedValue(new Error('Redis cluster down')),
      };

      const { bus } = setupTestBus({ publisher: rejectingPublisher });
      const result = await bus.publish(createSampleEvent());

      expect(result).toBe(false);
      expect(bus.getMetrics().publishFailures).toBe(1);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.stringContaining('[locationEventBus] Redis publish failed')
      );
    });

    it('falls back to local-only mode when publisher is not supplied', async () => {
      const bus = createLocationEventBus({ channel: TEST_CHANNEL });
      bus.init(null);

      const published = await bus.publish(createSampleEvent());
      expect(published).toBe(false);
      expect(bus.getState().enabled).toBe(false);
      expect(bus.isReady()).toBe(false);
    });

    it('handles subscriber factory returning null gracefully', () => {
      const bus = createLocationEventBus({
        channel: TEST_CHANNEL,
        publisher: { publish: vi.fn() },
        subscriberFactory: () => null,
      });

      bus.init();
      expect(bus.getState().enabled).toBe(false);
      expect(bus.isReady()).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ channel: TEST_CHANNEL }),
        expect.stringContaining('[locationEventBus] Subscriber unavailable')
      );
    });

    it('handles subscriber subscription error callbacks', () => {
      const errorSubscriber = new FakeSubscriber(new InMemoryHub());
      errorSubscriber.subscribe = vi.fn((_ch, cb) => cb(new Error('Subscription failed')));

      const bus = createLocationEventBus({
        channel: TEST_CHANNEL,
        publisher: { publish: vi.fn() },
        subscriberFactory: () => errorSubscriber,
      });

      bus.init();
      expect(bus.getMetrics().subscriberErrors).toBe(1);
      expect(bus.getState().subscribed).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.stringContaining('[locationEventBus] Failed to subscribe to channel.')
      );
    });

    it('falls back to disconnect if subscriber.quit() rejects during close()', async () => {
      const failingSubscriber = new FakeSubscriber(new InMemoryHub());
      failingSubscriber.quit = vi.fn().mockRejectedValue(new Error('Quit rejected'));
      const disconnectSpy = vi.spyOn(failingSubscriber, 'disconnect');

      const { bus } = setupTestBus({ fakeSubscriber: failingSubscriber });
      await bus.close();

      expect(disconnectSpy).toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.stringContaining('[locationEventBus] subscriber.quit failed, falling back to disconnect.')
      );
    });
  });

  describe('Lifecycle, Readiness, and State Inspection', () => {
    it('correctly updates readiness state during connection drops and reconnects', () => {
      const { bus, fakeSubscriber } = setupTestBus();
      expect(bus.isReady()).toBe(true);
      expect(bus.getState().subscribed).toBe(true);
      expect(bus.getState().ready).toBe(true);

      // Connection dropped
      fakeSubscriber._dropConnection();
      expect(bus.isReady()).toBe(false);
      expect(bus.getState().subscribed).toBe(false);

      // Connection re-established
      fakeSubscriber._reconnect();
      expect(bus.isReady()).toBe(true);
      expect(bus.getState().subscribed).toBe(true);
    });

    it('getState() exposes comprehensive bus state metadata', () => {
      const { bus } = setupTestBus({ instanceId: 'replica-omega' });
      const state = bus.getState();

      expect(state.channel).toBe(TEST_CHANNEL);
      expect(state.instanceId).toBe('replica-omega');
      expect(state.enabled).toBe(true);
      expect(state.connected).toBe(true);
      expect(state.subscribed).toBe(true);
      expect(state.ready).toBe(true);
      expect(typeof state.metrics).toBe('object');
    });

    it('getInstanceId returns the configured replica identifier', () => {
      const { bus } = setupTestBus({ instanceId: 'replica-alpha-99' });
      expect(bus.getInstanceId()).toBe('replica-alpha-99');
    });

    it('close() is idempotent and shuts down the bus completely', async () => {
      const { bus, fakeSubscriber } = setupTestBus();
      await bus.close();

      expect(bus.isReady()).toBe(false);
      expect(bus.getState().subscribed).toBe(false);
      expect(fakeSubscriber.status).toBe('end');

      // Second call should resolve cleanly without error
      await expect(bus.close()).resolves.toBeUndefined();
    });
  });
});
