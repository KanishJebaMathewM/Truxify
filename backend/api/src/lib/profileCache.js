import * as db from '../config/db.js';

const TTL_SECONDS = 900; // 15 minutes
const cacheKey = (firebaseUid) => `user:profile:${firebaseUid}`;

/**
 * Helper to safely retrieve the redisClient from the database configuration.
 * Prevents Vitest module resolution issues in tests that partially mock db.js.
 */
function getRedisClient() {
  try {
    return db.redisClient;
  } catch (err) {
    return null;
  }
}

/**
 * Retrieves a user profile from the Redis cache.
 * Falls back to null on cache miss or Redis error.
 * 
 * @param {string} firebaseUid - The Firebase UID of the user.
 * @returns {Promise<object|null>} The parsed cached profile, or null.
 */
export async function getCachedProfile(firebaseUid) {
  const redisClient = getRedisClient();
  if (!redisClient || !firebaseUid) return null;
  try {
    const raw = await redisClient.get(cacheKey(firebaseUid));
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.error('Redis getCachedProfile error:', err.message);
    return null;
  }
}

/**
 * Stores a user profile in the Redis cache.
 * Gracefully handles Redis errors.
 * 
 * @param {string} firebaseUid - The Firebase UID of the user.
 * @param {object} profile - The user profile object to cache.
 * @returns {Promise<void>}
 */
export async function setCachedProfile(firebaseUid, profile) {
  const redisClient = getRedisClient();
  if (!redisClient || !firebaseUid || !profile) return;
  try {
    await redisClient.set(cacheKey(firebaseUid), JSON.stringify(profile), 'EX', TTL_SECONDS);
  } catch (err) {
    console.error('Redis setCachedProfile error:', err.message);
  }
}

/**
 * Invalidates (deletes) a cached user profile from Redis.
 * Gracefully handles Redis errors.
 * 
 * @param {string} firebaseUid - The Firebase UID of the user.
 * @returns {Promise<void>}
 */
export async function invalidateCachedProfile(firebaseUid) {
  const redisClient = getRedisClient();
  if (!redisClient || !firebaseUid) return;
  try {
    await redisClient.del(cacheKey(firebaseUid));
  } catch (err) {
    console.error('Redis invalidateCachedProfile error:', err.message);
  }
}
