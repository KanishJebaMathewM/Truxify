import { createCacheEvent, serializeCacheEvent, deserializeCacheEvent, CacheEventType } from './CacheEvent.js';
import logger from '../middleware/logger.js';
import { redisClient } from '../config/db.js';

export class CacheEventManager {
    constructor(instanceId) {
        this.instanceId = instanceId || crypto.randomUUID();
        this.subscribedNamespaces = new Set();
    }

    async publishEvent(event) {
        if (!redisClient) {
            logger.warn('[CacheEventManager] Redis client not available. Event not published.', event);
            return false;
        }

        const channel = `cache_events:${event.namespace}`;
        const payload = serializeCacheEvent(event);

        try {
            await redisClient.publish(channel, payload);
            logger.debug(`[CacheEventManager] Published event to ${channel}`, { eventId: event.id });
            return true;
        } catch (err) {
            logger.error({ err, channel }, '[CacheEventManager] Failed to publish cache event');
            return false;
        }
    }

    async invalidateKey(namespace, key) {
        const event = createCacheEvent(CacheEventType.INVALIDATE_KEY, {
            namespace,
            key,
            originInstanceId: this.instanceId,
        });
        return this.publishEvent(event);
    }

    async invalidatePattern(namespace, pattern) {
        const event = createCacheEvent(CacheEventType.INVALIDATE_PATTERN, {
            namespace,
            pattern,
            originInstanceId: this.instanceId,
        });
        return this.publishEvent(event);
    }

    async invalidateNamespace(namespace) {
        const event = createCacheEvent(CacheEventType.INVALIDATE_NAMESPACE, {
            namespace,
            originInstanceId: this.instanceId,
        });
        return this.publishEvent(event);
    }

    subscribe(namespace, handler) {
        if (!redisClient) {
            logger.warn('[CacheEventManager] Redis client not available. Cannot subscribe.');
            return;
        }

        const channel = `cache_events:${namespace}`;

        redisClient.subscribe(channel, (message) => {
            const event = deserializeCacheEvent(message);
            if (event) {
                // Prevent infinite loops by ignoring events originated by this instance
                if (event.originInstanceId === this.instanceId) {
                    return;
                }
                handler(event);
            }
        });

        this.subscribedNamespaces.add(namespace);
        logger.info(`[CacheEventManager] Subscribed to cache events for namespace: ${namespace}`);
    }

    unsubscribe(namespace) {
        if (!redisClient) return;

        const channel = `cache_events:${namespace}`;
        redisClient.unsubscribe(channel);
        this.subscribedNamespaces.delete(namespace);
        logger.info(`[CacheEventManager] Unsubscribed from cache events for namespace: ${namespace}`);
    }
}

export const globalCacheEventManager = new CacheEventManager(process.env.INSTANCE_ID);
