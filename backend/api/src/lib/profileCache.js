import * as db from '../config/db.js';

export const TTL_SECONDS = 900; // 15 minutes
const cacheKey = (firebaseUid) => `user:profile:${firebaseUid}`;

/**
 * Retrieves the redisClient from the database configuration.
 * Under Vitest, accessing a property on a mocked namespace module that is not explicitly
 * returned in the mock factory will throw an error via the mock Proxy. We wrap the access
 * in a try-catch to allow a graceful fallback to null.
 * 
 * @returns {object|null} The Redis client if configured, or null.
 */
let hasLoggedRedisClientError = false;

function getRedisClient() {
  try {
    return db.redisClient ?? null;
  } catch (err) {
    // Under Vitest testing, accessing undefined keys on namespace mock proxies throws.
    // We suppress mock proxy errors in tests, but log genuine unexpected errors in production once.
    const isVitestMockError = process.env.NODE_ENV === 'test' || 
      (err.message && (err.message.includes('mock') || err.message.includes('spy')));
    if (!isVitestMockError && !hasLoggedRedisClientError) {
      console.error('Unexpected error resolving redisClient from db config:', err);
      hasLoggedRedisClientError = true;
    }
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
    console.error('Redis getCachedProfile error:', err);
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
    console.error('Redis setCachedProfile error:', err);
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
    console.error('Redis invalidateCachedProfile error:', err);
  }
}
