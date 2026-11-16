import { redisClient } from '../../config/db.js';
import logger from '../../middleware/logger.js';

// Base benchmark diesel price (in INR per litre) used as baseline in freight contracts
export const BASE_BENCHMARK_DIESEL_INR = 90.00;

// Fallback regional diesel prices (INR / Litre)
export const DEFAULT_STATE_DIESEL_PRICES = Object.freeze({
  MAHARASHTRA: 92.50,
  DELHI: 87.62,
  GUJARAT: 92.14,
  KARNATAKA: 87.90,
  TAMIL_NADU: 92.34,
  UTTAR_PRADESH: 87.68,
  HARYANA: 88.35,
  RAJASTHAN: 93.72,
  WEST_BENGAL: 91.76,
  DEFAULT: 90.00,
});

export class DieselIndexAggregator {
  /**
   * @param {object} [options={}]
   * @param {number} [options.benchmarkPrice=90.00]
   * @param {number} [options.cacheTtlSeconds=86400] - 24 hours
   */
  constructor(options = {}) {
    this.benchmarkPrice = options.benchmarkPrice || BASE_BENCHMARK_DIESEL_INR;
    this.cacheTtlSeconds = options.cacheTtlSeconds || 86400;
  }

  /**
   * Builds the Redis cache key for a state/district.
   * @param {string} region
   * @returns {string}
   */
  _buildCacheKey(region) {
    const clean = (region || 'DEFAULT').toUpperCase().replace(/\s+/g, '_');
    return `diesel:price:${clean}`;
  }

  /**
   * Gets current diesel price for a state/district and calculates the fuel multiplier.
   * 
   * @param {string} region - State or district name (e.g., 'Maharashtra', 'Delhi')
   * @returns {Promise<{currentPriceInr: number, benchmarkInr: number, fuelMultiplier: number, source: string}>}
   */
  async getDieselIndex(region = 'DEFAULT') {
    const regionKey = (region || 'DEFAULT').toUpperCase().replace(/\s+/g, '_');
    const cacheKey = this._buildCacheKey(regionKey);

    // 1. Try fetching cached price from Redis
    if (redisClient && typeof redisClient.get === 'function') {
      try {
        const cached = await redisClient.get(cacheKey);
        if (cached) {
          const currentPriceInr = parseFloat(cached);
          const fuelMultiplier = Number((currentPriceInr / this.benchmarkPrice).toFixed(4));
          return {
            currentPriceInr,
            benchmarkInr: this.benchmarkPrice,
            fuelMultiplier,
            source: 'CACHE_REDIS',
            region: regionKey,
          };
        }
      } catch (err) {
        logger.warn({ err, region }, '[DieselIndexAggregator] Redis cache lookup failed');
      }
    }

    // 2. Fallback to default state price index
    const fallbackPrice = DEFAULT_STATE_DIESEL_PRICES[regionKey] || DEFAULT_STATE_DIESEL_PRICES.DEFAULT;
    const fuelMultiplier = Number((fallbackPrice / this.benchmarkPrice).toFixed(4));

    // 3. Populate Redis asynchronously
    if (redisClient && typeof redisClient.set === 'function') {
      redisClient
        .set(cacheKey, fallbackPrice.toString(), 'EX', this.cacheTtlSeconds)
        .catch((err) => logger.warn({ err }, '[DieselIndexAggregator] Failed caching diesel price'));
    }

    return {
      currentPriceInr: fallbackPrice,
      benchmarkInr: this.benchmarkPrice,
      fuelMultiplier,
      source: 'DEFAULT_INDEX',
      region: regionKey,
    };
  }

  /**
   * Updates or scrapes new diesel price for a region into the cache.
   * 
   * @param {string} region
   * @param {number} priceInr
   * @returns {Promise<boolean>}
   */
  async updateDistrictPrice(region, priceInr) {
    if (!Number.isFinite(priceInr) || priceInr <= 0) {
      throw new Error(`Invalid diesel price: ${priceInr}`);
    }

    const regionKey = (region || 'DEFAULT').toUpperCase().replace(/\s+/g, '_');
    const cacheKey = this._buildCacheKey(regionKey);

    if (redisClient && typeof redisClient.set === 'function') {
      await redisClient.set(cacheKey, priceInr.toString(), 'EX', this.cacheTtlSeconds);
      logger.info({ region: regionKey, priceInr }, '[DieselIndexAggregator] Updated district diesel price');
      return true;
    }

    return false;
  }
}

export default DieselIndexAggregator;
