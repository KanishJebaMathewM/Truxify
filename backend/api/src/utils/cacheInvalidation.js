import { upstashRedisClient } from '../config/db.js';
import logger from '../middleware/logger.js';

/**
 * Gets the current version of the truck search cache.
 *
 * @returns {Promise<string>}
 */
export async function getTruckSearchVersion() {
  try {
    const version = await upstashRedisClient.get('version:truck_search');
    return version || '1';
  } catch (err) {
    logger.warn({ err }, '[Cache] Failed to get truck search version');
    return '1';
  }
}

/**
 * Invalidates booking-related caches by incrementing the truck search cache version.
 *
 * @returns {Promise<void>}
 */
export async function invalidateBookingCaches() {
  try {
    const nextVersion = Date.now().toString();
    await upstashRedisClient.set('version:truck_search', nextVersion);
    logger.info({ nextVersion }, '[Cache] Booking-related caches invalidated successfully.');
  } catch (err) {
    logger.error({ err }, '[Cache] Failed to invalidate booking caches');
  }
}
