/**
 * Centralized cache invalidation engine.
 *
 * Provides a single entry point for all cache mutations and
 * coordinates local deletion with cross-instance Pub/Sub propagation.
 *
 * Flow:
 *   1. Local Redis DEL (or SCAN + DEL for patterns)
 *   2. Publish invalidation event via Pub/Sub
 *   3. Remote instances receive the event and apply the same DEL
 *
 * This ensures that all backend instances see consistent data
 * without waiting for TTL expiry.
 */

import { CacheNamespace } from './CacheNamespace.js';
import { CacheKeyBuilder } from './CacheKeyBuilder.js';
import { CacheEventType } from './CacheEvent.js';
import {
  publishInvalidation,
  subscribeToInvalidation,
  setupMessageHandler,
  getInstanceId,
} from './CachePublisher.js';
import logger from '../middleware/logger.js';

let redisClient = null;
let initialized = false;

const stats = {
  invalidations: 0,
  publishes: 0,
  remoteEventsHandled: 0,
  errors: 0,
  patternScans: 0,
};

/**
 * Initialize the invalidator with the Redis client.
 *
 * @param {object} client — ioredis instance
 */
export function initCacheInvalidator(client) {
  if (initialized) return;
  redisClient = client;

  if (!client) {
    logger.warn('[CacheInvalidator] No Redis client — invalidation will be no-op.');
    return;
  }

  // Subscribe to all namespaces that have Pub/Sub enabled
  const allNs = CacheNamespace.all();
  for (const [name, ns] of allNs) {
    if (ns.enablePubSub) {
      subscribeToInvalidation(name, (event) => {
        handleRemoteEvent(event).catch((err) => {
          logger.error({ err, namespace: name }, '[CacheInvalidator] Remote event handling failed.');
        });
      });
    }
  }

  setupMessageHandler(null);
  initialized = true;
  logger.info('[CacheInvalidator] Initialized.');
}

/**
 * Handle an event received from a remote instance via Pub/Sub.
 * Applies the invalidation locally without re-publishing.
 *
 * @param {object} event — deserialized CacheEvent
 */
export async function handleRemoteEvent(event) {
  if (!redisClient || !event) return;

  stats.remoteEventsHandled++;

  try {
    switch (event.type) {
      case CacheEventType.INVALIDATE_KEY:
        if (event.key) {
          await redisClient.del(event.key);
          logger.debug({ key: event.key, origin: event.originInstanceId }, '[CacheInvalidator] Remote key invalidated.');
        }
        break;

      case CacheEventType.INVALIDATE_PATTERN:
        if (event.pattern) {
          await scanAndDelete(event.pattern);
          logger.debug({ pattern: event.pattern, origin: event.originInstanceId }, '[CacheInvalidator] Remote pattern invalidated.');
        }
        break;

      case CacheEventType.INVALIDATE_NAMESPACE:
        if (event.namespace) {
          const pattern = CacheKeyBuilder.pattern(event.namespace);
          await scanAndDelete(pattern);
          logger.debug({ namespace: event.namespace, origin: event.originInstanceId }, '[CacheInvalidator] Remote namespace invalidated.');
        }
        break;

      case CacheEventType.BUMP_VERSION:
        if (event.namespace && event.entityId) {
          const versionKey = CacheKeyBuilder.versionKey(event.namespace, event.entityId, event.subKey);
          await redisClient.incr(versionKey);
          logger.debug({ namespace: event.namespace, entityId: event.entityId }, '[CacheInvalidator] Remote version bumped.');
        }
        break;

      case CacheEventType.REFRESH:
        // Informational only — no local action needed
        break;

      default:
        logger.warn({ type: event.type }, '[CacheInvalidator] Unknown event type.');
    }
  } catch (err) {
    stats.errors++;
    logger.error({ err, event }, '[CacheInvalidator] Error applying remote event.');
  }
}

/**
 * Invalidate a single cache key both locally and across instances.
 *
 * @param {string} namespace
 * @param {string} key — the full Redis key to delete
 * @param {object} [opts]
 * @param {boolean} [opts.localOnly] — skip Pub/Sub propagation
 */
export async function invalidateKey(namespace, key, opts = {}) {
  if (!redisClient) return;

  stats.invalidations++;

  try {
    await redisClient.del(key);
  } catch (err) {
    stats.errors++;
    logger.error({ err, key }, '[CacheInvalidator] Local key invalidation failed.');
    return;
  }

  if (!opts.localOnly) {
    try {
      await publishInvalidation(namespace, {
        type: CacheEventType.INVALIDATE_KEY,
        key,
      });
      stats.publishes++;
    } catch (err) {
      logger.error({ err, key }, '[CacheInvalidator] Failed to publish invalidation.');
    }
  }
}

/**
 * Invalidate all keys matching a glob pattern locally and across instances.
 *
 * @param {string} namespace
 * @param {string} pattern — SCAN-compatible glob
 * @param {object} [opts]
 * @param {boolean} [opts.localOnly]
 */
export async function invalidatePattern(namespace, pattern, opts = {}) {
  if (!redisClient) return;

  stats.invalidations++;

  try {
    await scanAndDelete(pattern);
  } catch (err) {
    stats.errors++;
    logger.error({ err, pattern }, '[CacheInvalidator] Local pattern invalidation failed.');
    return;
  }

  if (!opts.localOnly) {
    try {
      await publishInvalidation(namespace, {
        type: CacheEventType.INVALIDATE_PATTERN,
        pattern,
      });
      stats.publishes++;
    } catch (err) {
      logger.error({ err, pattern }, '[CacheInvalidator] Failed to publish pattern invalidation.');
    }
  }
}

/**
 * Invalidate all keys in a namespace.
 *
 * @param {string} namespace
 * @param {object} [opts]
 * @param {boolean} [opts.localOnly]
 */
export async function invalidateNamespace(namespace, opts = {}) {
  if (!redisClient) return;

  const pattern = CacheKeyBuilder.pattern(namespace);
  await invalidatePattern(namespace, pattern, opts);
}

/**
 * Bump the version counter for a namespaced entity. All versioned keys
 * for this entity become stale.
 *
 * @param {string} namespace
 * @param {string} entityId
 * @param {string} [subKey]
 * @param {object} [opts]
 * @param {boolean} [opts.localOnly]
 */
export async function bumpVersion(namespace, entityId, subKey, opts = {}) {
  if (!redisClient) return;

  const versionKey = CacheKeyBuilder.versionKey(namespace, entityId, subKey);

  try {
    await redisClient.incr(versionKey);
    // Optionally set a long TTL on the version key itself so old versions
    // don't linger forever in Redis.
    await redisClient.expire(versionKey, 86400 * 30);
  } catch (err) {
    stats.errors++;
    logger.error({ err, versionKey }, '[CacheInvalidator] Failed to bump version.');
    return;
  }

  if (!opts.localOnly) {
    try {
      await publishInvalidation(namespace, {
        type: CacheEventType.BUMP_VERSION,
        entityId,
        subKey,
      });
      stats.publishes++;
    } catch (err) {
      logger.error({ err, versionKey }, '[CacheInvalidator] Failed to publish version bump.');
    }
  }
}

/**
 * Get current invalidation statistics.
 */
export function getStats() {
  return { ...stats };
}

/**
 * Reset stats counters (for testing).
 */
export function resetStats() {
  stats.invalidations = 0;
  stats.publishes = 0;
  stats.remoteEventsHandled = 0;
  stats.errors = 0;
  stats.patternScans = 0;
}

// ── Internal helpers ────────────────────────────────────────────────

/**
 * SCAN-based key deletion. Iterates the keyspace in batches to avoid
 * blocking Redis on large datasets.
 *
 * @param {string} pattern — SCAN glob
 * @param {number} [batchSize=100]
 */
async function scanAndDelete(pattern, batchSize = 100) {
  let cursor = '0';
  let totalDeleted = 0;

  do {
    const [nextCursor, keys] = await redisClient.scan(
      cursor,
      'MATCH',
      pattern,
      'COUNT',
      batchSize
    );
    cursor = nextCursor;

    if (keys.length > 0) {
      const pipeline = redisClient.pipeline();
      for (const key of keys) {
        pipeline.del(key);
      }
      await pipeline.exec();
      totalDeleted += keys.length;
    }
  } while (cursor !== '0');

  stats.patternScans++;

  if (totalDeleted > 0) {
    logger.debug({ pattern, deleted: totalDeleted }, '[CacheInvalidator] Pattern scan completed.');
  }
}

export default {
  initCacheInvalidator,
  handleRemoteEvent,
  invalidateKey,
  invalidatePattern,
  invalidateNamespace,
  bumpVersion,
  getStats,
  resetStats,
};
