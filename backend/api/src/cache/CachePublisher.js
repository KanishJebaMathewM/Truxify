/**
 * Redis Pub/Sub publisher and subscriber for cross-instance cache
 * invalidation events.
 *
 * Architecture:
 *   Instance A writes to cache → publishes INVALIDATE event to Redis channel
 *   Instance B subscribes to the same channel → receives event → invalidates local state
 *
 * The publisher uses the same ioredis client for publishing (no extra connection).
 * A dedicated subscriber client is required because Redis clients in subscribe
 * mode can only issue SUBSCRIBE/PSUBSCRIBE commands.
 *
 * Graceful degradation:
 *   - If Redis is unavailable, publish/subscribe becomes a no-op.
 *   - If the subscriber disconnects, it reconnects automatically (ioredis built-in).
 */

import Redis from 'ioredis';
import { CacheNamespace } from './CacheNamespace.js';
import { CacheKeyBuilder } from './CacheKeyBuilder.js';
import { createCacheEvent, serializeCacheEvent, CacheEventType } from './CacheEvent.js';
import logger from '../middleware/logger.js';

let subscriber = null;
let publishClient = null;
const listeners = new Map();
let initialized = false;
let instanceId = `instance-${process.pid}-${Date.now()}`;

/**
 * Initialize the Pub/Sub system with Redis clients.
 *
 * @param {object} redisClient — the main ioredis client used for cache operations
 */
export function initCachePublisher(redisClient) {
  if (initialized) return;

  if (!redisClient) {
    logger.warn('[CachePublisher] No Redis client provided — Pub/Sub disabled.');
    return;
  }

  publishClient = redisClient;

  try {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      logger.warn('[CachePublisher] REDIS_URL not set — Pub/Sub subscriber disabled.');
      return;
    }

    subscriber = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        const delay = Math.min(times * 200, 5000);
        return delay;
      },
      enableOfflineQueue: false,
    });

    subscriber.on('connect', () => {
      logger.info('[CachePublisher] Subscriber connected to Redis.');
    });

    subscriber.on('error', (err) => {
      logger.error({ err }, '[CachePublisher] Subscriber connection error.');
    });

    subscriber.on('reconnecting', () => {
      logger.info('[CachePublisher] Subscriber reconnecting...');
    });

    initialized = true;
    logger.info({ instanceId }, '[CachePublisher] Initialized.');
  } catch (err) {
    logger.error({ err }, '[CachePublisher] Failed to initialize subscriber.');
  }
}

/**
 * Publish a cache invalidation event to the namespace channel.
 *
 * @param {string} namespace
 * @param {object} eventOpts — options forwarded to createCacheEvent
 */
export async function publishInvalidation(namespace, eventOpts = {}) {
  if (!publishClient || !CacheNamespace.isValid(namespace)) return;

  const ns = CacheNamespace.get(namespace);
  if (!ns.enablePubSub) return;

  const channel = CacheKeyBuilder.pubSubChannel(namespace);
  const event = createCacheEvent(eventOpts.type || CacheEventType.INVALIDATE_KEY, {
    namespace,
    originInstanceId: instanceId,
    ...eventOpts,
  });

  try {
    await publishClient.publish(channel, serializeCacheEvent(event));
  } catch (err) {
    logger.error({ err, namespace, eventId: event.id }, '[CachePublisher] Failed to publish invalidation event.');
  }
}

/**
 * Subscribe to invalidation events for a specific namespace.
 *
 * @param {string} namespace
 * @param {function} handler — async function(event) called when an event is received
 * @returns {function} unsubscribe function
 */
export function subscribeToInvalidation(namespace, handler) {
  if (!subscriber) {
    logger.warn('[CachePublisher] Subscriber not initialized — subscription ignored.');
    return () => {};
  }

  const channel = CacheKeyBuilder.pubSubChannel(namespace);

  if (!listeners.has(namespace)) {
    listeners.set(namespace, new Set());

    subscriber.subscribe(channel, (err) => {
      if (err) {
        logger.error({ err, namespace }, '[CachePublisher] Failed to subscribe to channel.');
      }
    });
  }

  listeners.get(namespace).add(handler);

  const unsubscribe = () => {
    const handlers = listeners.get(namespace);

    if (handlers) {
      handlers.delete(handler);

      if (handlers.size === 0) {
        listeners.delete(namespace);
        subscriber.unsubscribe(channel).catch((err) => {
          logger.warn(
            { err, channel, namespace },
            'Failed to unsubscribe from Redis channel'
          );
        });        
      }
    }
  };

  return unsubscribe;
}

/**
 * Set up the message handler that dispatches incoming Pub/Sub messages
 * to registered listeners. Called once during initialization.
 */
export function setupMessageHandler(cacheInvalidator) {
  if (!subscriber) return;

  subscriber.on('message', (channel, message) => {
    const event = (() => {
      try {
        return JSON.parse(message);
      } catch (err) {
        logger.warn({ err, channel, messagePreview: message.slice(0, 100) }, '[CachePublisher] Failed to parse event from Redis channel.');
        return null;
      }
    })();

    if (!event) {
      logger.warn({ channel }, '[CachePublisher] Received malformed event.');
      return;
    }

    // Ignore events from this instance to avoid self-invalidation loops
    if (event.originInstanceId === instanceId) return;

    const namespace = event.namespace;
    const handlers = listeners.get(namespace);
    if (handlers && handlers.size > 0) {
      for (const handler of handlers) {
        try {
          const result = handler(event);
          if (result && typeof result.catch === 'function') {
            result.catch((err) =>
              logger.error({ err, eventId: event.id }, '[CachePublisher] Async handler error.')
            );
          }
        } catch (err) {
          logger.error({ err, eventId: event.id }, '[CachePublisher] Handler error.');
        }
      }
    }

    // Apply default invalidation via the CacheInvalidator if provided
    if (cacheInvalidator) {
      cacheInvalidator.handleRemoteEvent(event).catch((err) => {
        logger.error({ err, eventId: event.id }, '[CachePublisher] Error handling remote event.');
      });
    }
  });
}

/**
 * Set the instance ID (useful for testing).
 * @param {string} id
 */
export function setInstanceId(id) {
  instanceId = id;
}

/**
 * Get the current instance ID.
 * @returns {string}
 */
export function getInstanceId() {
  return instanceId;
}

/**
 * Check whether the Pub/Sub system is initialized.
 * @returns {boolean}
 */
export function isInitialized() {
  return initialized;
}

/**
 * Get the subscriber client (for testing).
 * @returns {object|null}
 */
export function getSubscriber() {
  return subscriber;
}

/**
 * Gracefully shut down the subscriber connection.
 */
export async function closeCachePublisher() {
  if (subscriber) {
    try {
      await subscriber.quit();
    } catch (err) {
      logger.warn({ err }, '[CachePublisher] subscriber.quit failed, falling back to disconnect');
      subscriber.disconnect();
    }
    subscriber = null;
  }
  listeners.clear();
  initialized = false;
  logger.info('[CachePublisher] Shut down.');
}

export default {
  initCachePublisher,
  publishInvalidation,
  subscribeToInvalidation,
  setupMessageHandler,
  setInstanceId,
  getInstanceId,
  isInitialized,
  getSubscriber,
  closeCachePublisher,
};
