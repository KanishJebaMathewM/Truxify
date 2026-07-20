import geohash from 'ngeohash';
import { redisClient } from '../../config/db.js';
import logger from '../../middleware/logger.js';

export class LoadOfferCacheService {
  static getRegion(lat, lng) {
    if (!lat || !lng) return 'global';
    return geohash.encode(Number(lat), Number(lng), 4);
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
    if (!redisClient) return;
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
