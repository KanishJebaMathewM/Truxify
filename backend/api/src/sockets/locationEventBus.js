/**
 * Redis Pub/Sub fan-out for live location events across API replicas.
 *
 * Problem:
 *   Each API replica keeps its own in-memory `trackingSubscriptions` registry.
 *   A location update that arrives on Replica A is broadcast only to A's local
 *   WebSocket clients, so customers connected to Replica B never receive it.
 *
 * Architecture:
 *   Driver (Replica A)
 *     → validate / sequence-check / rate-limit / persist (unchanged)
 *     → publish an internal `location_update` event to a shared Redis channel
 *     → deliver to Replica A's local subscribers immediately (no latency cost,
 *       no dependence on Redis)
 *     → Redis Pub/Sub fans the event out to every other replica
 *     → each remote replica validates the event, then delivers it to its own
 *       local subscribers only
 *
 * Duplicate prevention (source-instance skip):
 *   The publishing replica already delivered the event locally, so its own
 *   Pub/Sub consumer SKIPS events whose `sourceInstanceId` matches this
 *   instance. Every replica therefore delivers each valid location event
 *   exactly once to each of its eligible local clients. This mirrors the
 *   existing CachePublisher pattern (`originInstanceId`).
 *
 * Reliability:
 *   - A dedicated subscriber connection is used because Redis clients in
 *     subscribe mode cannot issue regular commands. ioredis reconnects
 *     automatically and re-subscribes to the channel after a drop.
 *   - Publishing is best-effort and never throws; local WebSocket delivery
 *     always proceeds even when Redis is unavailable.
 *   - Malformed Pub/Sub messages are rejected, counted and logged — they never
 *     reach WebSocket clients and never crash the process.
 *   - Channel subscriptions are restored on reconnect; resources are released
 *     on close().
 *
 * Testing:
 *   `createLocationEventBus` accepts an injectable `subscriberFactory` and
 *   `publisher`, so distributed tests can connect several instances to an
 *   in-memory transport that mimics Redis Pub/Sub without a live server.
 */

import Redis from 'ioredis';
import logger from '../middleware/logger.js';

const DEFAULT_CHANNEL = 'truxify:tracking:locations';
const EVENT_TYPE = 'location_update';
const EVENT_VERSION = 1;
const MAX_PAYLOAD_BYTES = 2048;
const MAX_ID_LENGTH = 64;

const EMPTY_METRICS = Object.freeze({
  published: 0,
  publishFailures: 0,
  received: 0,
  delivered: 0,
  droppedMalformed: 0,
  droppedNoSubscribers: 0,
  subscriberErrors: 0,
  subscriberReconnects: 0,
});

/**
 * Validate an internal Pub/Sub event before it is forwarded to local
 * WebSocket clients. Redis Pub/Sub messages are treated as untrusted input:
 * anything that does not conform to the internal schema is rejected.
 *
 * @param {unknown} event - Parsed message received from the channel.
 * @returns {string|null} Reason string when invalid, `null` when valid.
 */
export function validateInternalEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return 'not-an-object';
  if (event.type !== EVENT_TYPE) return 'unknown-type';
  if (event.v !== EVENT_VERSION) return 'unsupported-version';
  if (
    typeof event.driverId !== 'string' ||
    event.driverId.length === 0 ||
    event.driverId.length > MAX_ID_LENGTH
  ) return 'invalid-driverId';
  if (
    typeof event.sourceInstanceId !== 'string' ||
    event.sourceInstanceId.length === 0 ||
    event.sourceInstanceId.length > MAX_ID_LENGTH
  ) return 'invalid-sourceInstanceId';
  if (
    typeof event.sequence !== 'number' ||
    !Number.isFinite(event.sequence) ||
    event.sequence < 0
  ) return 'invalid-sequence';

  const location = event.location;
  if (!location || typeof location !== 'object' || Array.isArray(location)) return 'invalid-location';
  const { lat, lng, speed, bearing } = location;
  if (typeof lat !== 'number' || Number.isNaN(lat) || lat < -90 || lat > 90) return 'invalid-lat';
  if (typeof lng !== 'number' || Number.isNaN(lng) || lng < -180 || lng > 180) return 'invalid-lng';
  if (
    speed !== undefined && speed !== null &&
    (typeof speed !== 'number' || Number.isNaN(speed) || speed < 0 || speed > 200)
  ) return 'invalid-speed';
  if (
    bearing !== undefined && bearing !== null &&
    (typeof bearing !== 'number' || Number.isNaN(bearing) || bearing < 0 || bearing > 360)
  ) return 'invalid-bearing';
  if (
    event.orderDisplayId !== undefined && event.orderDisplayId !== null &&
    (typeof event.orderDisplayId !== 'string' ||
      event.orderDisplayId.length === 0 ||
      event.orderDisplayId.length > MAX_ID_LENGTH)
  ) return 'invalid-orderDisplayId';
  if (event.timestamp !== undefined && typeof event.timestamp !== 'string') return 'invalid-timestamp';

  return null;
}

/**
 * Default subscriber factory — creates the dedicated ioredis subscriber
 * connection from REDIS_URL. Injectable for tests.
 */
function defaultSubscriberFactory() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return null;
  return new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      const delay = Math.min(times * 200, 5000);
      return delay;
    },
    enableOfflineQueue: false,
  });
}

/**
 * Create an isolated location-event bus.
 *
 * A singleton is created inside the WebSocket tracker; tests may create
 * additional instances connected to a shared in-memory transport to simulate
 * multiple replicas.
 *
 * @param {object} [options]
 * @param {object} [options.publisher] - ioredis-compatible client used to publish.
 * @param {Function} [options.subscriberFactory] - factory returning an
 *   ioredis-compatible subscriber connection.
 * @param {string} [options.channel] - Redis channel name.
 * @param {string} [options.instanceId] - Stable id of this replica/instance.
 */
export function createLocationEventBus(options = {}) {
  const channel = options.channel || process.env.LOCATION_EVENTS_CHANNEL || DEFAULT_CHANNEL;
  const subscriberFactory = options.subscriberFactory || defaultSubscriberFactory;
  const instanceId = options.instanceId || `instance-${process.pid}-${Date.now()}`;

  const metrics = { ...EMPTY_METRICS };
  const handlers = new Set();
  let publishClient = options.publisher || null;
  let subscriber = null;
  let subscribed = false;
  let subscribedRequested = false;
  let shuttingDown = false;

  function getMetrics() {
    return { ...metrics };
  }

  /**
   * True when the subscriber connection is active and subscribed to the
   * channel — i.e. the distributed fan-out path is operational.
   */
  function isReady() {
    return Boolean(subscriber && subscribed && !shuttingDown);
  }

  function getState() {
    return {
      channel,
      instanceId,
      enabled: Boolean(subscriber),
      connected: Boolean(subscriber && subscriber.status === 'ready'),
      subscribed,
      ready: isReady(),
      metrics: getMetrics(),
    };
  }

  /**
   * Initialize the bus with the main Redis client used for publishing.
   * Idempotent. When no publisher is available the bus degrades to
   * local-only operation (publish() returns false, no subscriber is created).
   */
  function init(publisher) {
    if (publisher) publishClient = publisher;
    if (subscriber) return;
    if (!publishClient) {
      logger.warn({ channel }, '[locationEventBus] No Redis publisher — distributed fan-out disabled (local-only).');
      return;
    }
    try {
      subscriber = subscriberFactory();
      if (!subscriber) {
        logger.warn({ channel }, '[locationEventBus] Subscriber unavailable — distributed fan-out disabled (local-only).');
        return;
      }
      subscriber.on('error', (err) => {
        metrics.subscriberErrors++;
        logger.error({ err, channel }, '[locationEventBus] Subscriber connection error.');
      });
      subscriber.on('reconnecting', () => {
        metrics.subscriberReconnects++;
        logger.warn({ channel }, '[locationEventBus] Subscriber reconnecting...');
      });
      subscriber.on('close', () => {
        subscribed = false;
      });
      subscriber.on('end', () => {
        subscribed = false;
      });
      subscriber.on('ready', () => {
        // ioredis re-issues SUBSCRIBE for previously subscribed channels after
        // a reconnect; reflect that in the readiness state.
        if (subscribedRequested) subscribed = true;
      });
      subscriber.on('message', (receivedChannel, rawMessage) => {
        if (receivedChannel === channel) handleMessage(rawMessage);
      });

      subscribedRequested = true;
      subscriber.subscribe(channel, (err) => {
        if (err) {
          metrics.subscriberErrors++;
          logger.error({ err, channel }, '[locationEventBus] Failed to subscribe to channel.');
          return;
        }
        subscribed = true;
        logger.info({ channel, instanceId }, '[locationEventBus] Subscribed to location event channel.');
      });
    } catch (err) {
      metrics.subscriberErrors++;
      logger.error({ err, channel }, '[locationEventBus] Failed to initialize subscriber.');
    }
  }

  /**
   * Publish an internal location event to the shared channel.
   * Best-effort: never throws. Resolves to true when Redis accepted it.
   */
  async function publish(event) {
    if (!publishClient) return false;
    let serialized;
    try {
      serialized = JSON.stringify(event);
    } catch (err) {
      metrics.publishFailures++;
      logger.error({ err, channel }, '[locationEventBus] Failed to serialize location event.');
      return false;
    }
    if (!serialized || serialized.length > MAX_PAYLOAD_BYTES) {
      metrics.publishFailures++;
      logger.warn(
        { channel, bytes: serialized ? serialized.length : 0 },
        '[locationEventBus] Location event exceeds payload limit — not published.',
      );
      return false;
    }
    try {
      await publishClient.publish(channel, serialized);
      metrics.published++;
      return true;
    } catch (err) {
      metrics.publishFailures++;
      logger.error({ err, channel }, '[locationEventBus] Redis publish failed (local delivery still proceeds).');
      return false;
    }
  }

  /**
   * Register a handler invoked for every VALID internal event received from
   * the channel. Returns an unsubscribe function.
   */
  function subscribe(handler) {
    if (typeof handler !== 'function') throw new TypeError('handler must be a function');
    handlers.add(handler);
    return () => handlers.delete(handler);
  }

  function handleMessage(rawMessage) {
    metrics.received++;
    let event = null;
    try {
      event = JSON.parse(rawMessage);
    } catch (err) {
      metrics.droppedMalformed++;
      logger.warn(
        { channel, preview: String(rawMessage).slice(0, 80) },
        '[locationEventBus] Dropped unparseable Pub/Sub message.',
      );
      return;
    }
    const invalidReason = validateInternalEvent(event);
    if (invalidReason) {
      metrics.droppedMalformed++;
      logger.warn(
        { channel, eventType: event && event.type, reason: invalidReason },
        '[locationEventBus] Dropped malformed location event.',
      );
      return;
    }
    for (const handler of handlers) {
      try {
        const result = handler(event);
        if (result && typeof result.catch === 'function') {
          result.catch((err) => logger.error({ err }, '[locationEventBus] Async handler error.'));
        }
      } catch (err) {
        logger.error({ err }, '[locationEventBus] Handler error.');
      }
    }
  }

  /** Record the number of local WebSocket deliveries performed. */
  function recordDelivery(count) {
    metrics.delivered += count;
  }

  /** Record an event that reached this replica with no eligible local subscriber. */
  function recordNoSubscribers() {
    metrics.droppedNoSubscribers++;
  }

  /**
   * Gracefully shut down the bus: stop delivery, unsubscribe, close the
   * subscriber connection and release all resources. Idempotent.
   */
  async function close() {
    shuttingDown = true;
    subscribed = false;
    subscribedRequested = false;
    if (subscriber) {
      try {
        await subscriber.unsubscribe(channel);
      } catch (_) { /* already closing */ }
      try {
        await subscriber.quit();
      } catch (err) {
        logger.warn({ err, channel }, '[locationEventBus] subscriber.quit failed, falling back to disconnect.');
        try { subscriber.disconnect(); } catch (_) { /* already closed */ }
      }
      subscriber = null;
    }
    handlers.clear();
    publishClient = null;
    logger.info({ channel }, '[locationEventBus] Shut down.');
  }

  return {
    init,
    publish,
    subscribe,
    close,
    isReady,
    getMetrics,
    getState,
    getInstanceId: () => instanceId,
    recordDelivery,
    recordNoSubscribers,
  };
}

export default { createLocationEventBus, validateInternalEvent };
