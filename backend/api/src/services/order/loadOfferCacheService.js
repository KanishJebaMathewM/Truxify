import geohash from 'ngeohash';
import { redisClient } from '../../config/db.js';
import logger from '../../middleware/logger.js';

export class LoadOfferCacheService {
  static getRegion(lat, lng) {
    if (lat === undefined || lat === null || lat === '') return 'global';
    if (lng === undefined || lng === null || lng === '') return 'global';

    const parsedLat = Number(lat);
    const parsedLng = Number(lng);

    if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) {
      return 'global';
    }

    return geohash.encode(parsedLat, parsedLng, 4);
  }

  static async getVersion(region) {
    if (!redisClient) return null;
    try {
      const version = await redisClient.get(`version:load_offers:region:${region}`);
      return version || null;
    } catch (err) {
      logger.warn('[LoadOfferCache] Redis error getting version:', err.message);
      return null;
    }
  }

  static async invalidateRegion(lat, lng) {
    if (!redisClient) {
      logger.warn('[LoadOfferCache] Redis unavailable, skipping cache invalidation');
      return;
    }
    try {
      const region = this.getRegion(lat, lng);
      await redisClient.incr(`version:load_offers:region:${region}`);
      if (region !== 'global') {
        await redisClient.incr(`version:load_offers:region:global`);
      }
    } catch (err) {
      logger.warn('[LoadOfferCache] Redis error invalidating cache:', err.message);
    }
  }
}
