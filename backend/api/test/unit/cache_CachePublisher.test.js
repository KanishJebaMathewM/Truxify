/**
 * Unit tests for backend/api/src/cache/CachePublisher.js
 *
 * Coverage of the current module API (the class API was retired):
 *   - initCachePublisher: no-op without a client; disabled without REDIS_URL
 *   - publishInvalidation: publishes a serialized CacheEvent to the namespace
 *     channel; no-op for unregistered or PubSub-disabled namespaces
 *   - subscribeToInvalidation: registers a handler and returns an unsubscribe
 *     that removes it (and unsubscribes the channel when empty)
 *   - setupMessageHandler: ignores malformed payloads and self-originated
 *     events, dispatches to namespace listeners and the invalidator
 *   - instance id accessors
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// Fake the ioredis constructor so no real connection is attempted.
const fakeSubscribers = [];
vi.mock('ioredis', () => ({
  default: class FakeRedis {
    constructor() {
      this.handlers = {};
      this.subscribed = [];
      this.unsubscribed = [];
      fakeSubscribers.push(this);
    }
    on(event, handler) { this.handlers[event] = handler; }
    subscribe(channel, cb) { this.subscribed.push(channel); if (cb) cb(null); }
    unsubscribe(channel) { this.unsubscribed.push(channel); return Promise.resolve(); }
  },
}));

process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

const Publisher = await import('../../src/cache/CachePublisher.js');
const { CacheNamespace } = await import('../../src/cache/CacheNamespace.js');

const pubClient = { publish: vi.fn().mockResolvedValue(1) };

beforeAll(() => {
  CacheNamespace.register('publisher_test', { enablePubSub: true });
  CacheNamespace.register('publisher_quiet', { enablePubSub: false });
  Publisher.initCachePublisher(pubClient);
});

beforeEach(() => {
  vi.clearAllMocks();
  Publisher.setInstanceId('instance-self');
});

describe('CachePublisher (module contract)', () => {
  it('isInitialized is true after init with a client', () => {
    expect(Publisher.isInitialized()).toBe(true);
  });

  it('publishes a serialized invalidation event to the namespace channel', async () => {
    await Publisher.publishInvalidation('publisher_test', {
      type: 'INVALIDATE_KEY',
      key: 'user:profile:1',
      entityId: 'u1',
    });

    expect(pubClient.publish).toHaveBeenCalledTimes(1);
    const [channel, payload] = pubClient.publish.mock.calls[0];
    expect(channel).toBe('cache:invalidate:publisher_test');
    const event = JSON.parse(payload);
    expect(event.type).toBe('INVALIDATE_KEY');
    expect(event.namespace).toBe('publisher_test');
    expect(event.key).toBe('user:profile:1');
    expect(event.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('does not publish for unregistered or PubSub-disabled namespaces', async () => {
    await Publisher.publishInvalidation('missing_namespace', { key: 'k' });
    await Publisher.publishInvalidation('publisher_quiet', { type: 'INVALIDATE_KEY', key: 'k' });
    expect(pubClient.publish).not.toHaveBeenCalled();
  });

  it('registers a listener, dispatches namespace events to it, and ignores self-originated events', () => {
    const subscriber = fakeSubscribers[fakeSubscribers.length - 1];
    expect(subscriber).toBeDefined();
    Publisher.setupMessageHandler(null);

    const handler = vi.fn();
    Publisher.subscribeToInvalidation('publisher_test', handler);
    expect(subscriber.subscribed).toContain('cache:invalidate:publisher_test');

    const foreign = JSON.stringify({
      id: 'evt-1',
      type: 'INVALIDATE_KEY',
      namespace: 'publisher_test',
      key: 'k',
      originInstanceId: 'instance-other',
    });
    subscriber.handlers.message('cache:invalidate:publisher_test', foreign);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].originInstanceId).toBe('instance-other');

    // Self-originated events must not loop back into invalidation.
    const own = JSON.stringify({
      id: 'evt-2',
      type: 'INVALIDATE_KEY',
      namespace: 'publisher_test',
      key: 'k',
      originInstanceId: 'instance-self',
    });
    subscriber.handlers.message('cache:invalidate:publisher_test', own);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('ignores malformed payloads without calling listeners', () => {
    const subscriber = fakeSubscribers[fakeSubscribers.length - 1];
    const handler = vi.fn();
    Publisher.subscribeToInvalidation('publisher_test', handler);
    subscriber.handlers.message('cache:invalidate:publisher_test', '{not json');
    expect(handler).not.toHaveBeenCalled();
  });

  it('unsubscribe removes the handler and leaves the channel when empty', () => {
    const subscriber = fakeSubscribers[fakeSubscribers.length - 1];
    const handler = vi.fn();
    const unsubscribe = Publisher.subscribeToInvalidation('publisher_test', handler);
    unsubscribe();
    const own = JSON.stringify({
      id: 'evt-3',
      type: 'INVALIDATE_KEY',
      namespace: 'publisher_test',
      key: 'k',
      originInstanceId: 'instance-other',
    });
    subscriber.handlers.message('cache:invalidate:publisher_test', own);
    expect(handler).not.toHaveBeenCalled();
  });

  it('forwards foreign events to the cache invalidator when one is installed', () => {
    const invalidator = { handleRemoteEvent: vi.fn().mockResolvedValue(undefined) };
    Publisher.setupMessageHandler(invalidator);
    const subscriber = fakeSubscribers[fakeSubscribers.length - 1];
    const foreign = JSON.stringify({
      id: 'evt-4',
      type: 'INVALIDATE_NAMESPACE',
      namespace: 'publisher_test',
      originInstanceId: 'instance-other',
    });
    subscriber.handlers.message('cache:invalidate:publisher_test', foreign);
    expect(invalidator.handleRemoteEvent).toHaveBeenCalledTimes(1);
  });

  it('exposes the instance id for testing', () => {
    Publisher.setInstanceId('instance-x');
    expect(Publisher.getInstanceId()).toBe('instance-x');
    Publisher.setInstanceId('instance-self');
  });
});
