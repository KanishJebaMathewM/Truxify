/**
 * @fileoverview Offline message queue using Redis lists.
 * Ensures messages sent to offline users are delivered upon reconnection.
 */

import { redisClient } from '../config/db.js';
import logger from '../middleware/logger.js';

const QUEUE_PREFIX = 'chat:offline_queue:';
const MAX_QUEUE_SIZE = 500; // Max messages to queue per user
const QUEUE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

/**
 * Enqueues a message for an offline user.
 * @param {string} userId - The recipient's user ID.
 * @param {object} message - The chat message payload.
 */
export async function enqueueOfflineMessage(userId, message) {
    if (!redisClient || redisClient.status !== 'ready') {
        logger.warn({ userId }, 'Redis unavailable, dropping offline chat message');
        return false;
    }

    const key = `${QUEUE_PREFIX}${userId}`;

    try {
        const pipeline = redisClient.pipeline();
        pipeline.rpush(key, JSON.stringify(message));
        pipeline.ltrim(key, -MAX_QUEUE_SIZE, -1); // Keep only last N messages
        pipeline.expire(key, QUEUE_TTL_SECONDS);

        await pipeline.exec();
        return true;
    } catch (err) {
        logger.error({ err, userId }, 'Failed to enqueue offline chat message');
        return false;
    }
}

/**
 * Drains and returns all queued messages for a user, clearing the queue.
 * @param {string} userId - The user's ID.
 * @returns {Promise<object[]>} Array of message payloads.
 */
export async function drainOfflineQueue(userId) {
    if (!redisClient || redisClient.status !== 'ready') {
        return [];
    }

    const key = `${QUEUE_PREFIX}${userId}`;

    try {
        // Atomic get-and-delete using LRANGE + DEL in a pipeline
        // Or just LPOP in a loop. LRANGE then DEL is safer for bulk.
        const messages = await redisClient.lrange(key, 0, -1);

        if (messages && messages.length > 0) {
            await redisClient.del(key);
            return messages.map(m => {
                try {
                    return JSON.parse(m);
                } catch {
                    return null;
                }
            }).filter(Boolean);
        }

        return [];
    } catch (err) {
        logger.error({ err, userId }, 'Failed to drain offline chat queue');
        return [];
    }
}

/**
 * Checks if a user has pending offline messages.
 * @param {string} userId 
 * @returns {Promise<number>} Number of pending messages.
 */
export async function getOfflineQueueSize(userId) {
    if (!redisClient || redisClient.status !== 'ready') return 0;

    try {
        return await redisClient.llen(`${QUEUE_PREFIX}${userId}`);
    } catch {
        return 0;
    }
}
