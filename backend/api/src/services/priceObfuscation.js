/**
 * Price Obfuscation Service
 * Introduces slight, randomized noise (+/- 1% to 2%) to estimated price outputs
 * for accounts that frequently search but have a low booking conversion rate.
 * This deters competitors from reverse-engineering the proprietary ML pricing model.
 */
import logger from '../middleware/logger.js';
import { supabase } from '../config/supabase.js';

const OBSCURATION_CONFIG = {
    MIN_NOISE_PERCENT: 0.01, // 1%
    MAX_NOISE_PERCENT: 0.02, // 2%
    SEARCH_THRESHOLD: 10,    // Minimum searches to be considered "frequent"
    CONVERSION_THRESHOLD: 0.2, // Below 20% conversion rate triggers obfuscation
    CACHE_TTL_MS: 300000     // 5 minutes cache for user metrics
};

// In-memory cache for user metrics to prevent DB spam
const metricsCache = new Map();
setInterval(() => {
    const now = Date.now();
    for (const [userId, data] of metricsCache.entries()) {
        if (now - data.timestamp > OBSCURATION_CONFIG.CACHE_TTL_MS) {
            metricsCache.delete(userId);
        }
    }
}, 60000).unref();

/**
 * Calculates the booking conversion rate for a user.
 * @param {string} userId - The user's unique identifier.
 * @returns {Promise<{searches: number, bookings: number, rate: number}>}
 */
async function getUserConversionMetrics(userId) {
    // Check cache first
    const cached = metricsCache.get(userId);
    if (cached && (Date.now() - cached.timestamp < OBSCURATION_CONFIG.CACHE_TTL_MS)) {
        return cached.metrics;
    }

    try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const { data: metrics, error } = await supabase
            .from('user_ml_metrics')
            .select('total_searches, total_bookings')
            .eq('user_id', userId)
            .gte('updated_at', thirtyDaysAgo.toISOString())
            .single();

        if (error || !metrics) {
            const safeMetrics = { searches: 0, bookings: 0, rate: 1.0 };
            metricsCache.set(userId, { metrics: safeMetrics, timestamp: Date.now() });
            return safeMetrics;
        }

        const searches = metrics.total_searches || 0;
        const bookings = metrics.total_bookings || 0;
        const rate = searches > 0 ? bookings / searches : 1.0;

        const result = { searches, bookings, rate };
        metricsCache.set(userId, { metrics: result, timestamp: Date.now() });
        return result;
    } catch (err) {
        logger.error({ err, userId }, '[PriceObfuscation] Failed to fetch user conversion metrics');
        const safeMetrics = { searches: 0, bookings: 0, rate: 1.0 };
        metricsCache.set(userId, { metrics: safeMetrics, timestamp: Date.now() });
        return safeMetrics;
    }
}

/**
 * Applies randomized noise to a given price estimate if the user meets the criteria.
 * @param {number} basePrice - The original price estimated by the ML model.
 * @param {string|null} userId - The user's unique identifier (null for anonymous).
 * @returns {Promise<number>} - The obfuscated price, or the base price if no obfuscation is needed.
 */
export async function applyPriceObfuscation(basePrice, userId) {
    if (!userId) {
        // Anonymous users get a default small noise to prevent baseline scraping
        return _applyNoise(basePrice, OBSCURATION_CONFIG.MIN_NOISE_PERCENT);
    }

    const metrics = await getUserConversionMetrics(userId);

    // Check if the user is a frequent searcher with low conversion
    if (metrics.searches >= OBSCURATION_CONFIG.SEARCH_THRESHOLD &&
        metrics.rate < OBSCURATION_CONFIG.CONVERSION_THRESHOLD) {

        logger.info({
            userId,
            searches: metrics.searches,
            rate: metrics.rate.toFixed(2)
        }, '[PriceObfuscation] Applying noise to low-conversion frequent searcher');

        const noisePercent = _getRandomFloat(
            OBSCURATION_CONFIG.MIN_NOISE_PERCENT,
            OBSCURATION_CONFIG.MAX_NOISE_PERCENT
        );

        return _applyNoise(basePrice, noisePercent);
    }

    // Normal user, return exact price
    return basePrice;
}

/**
 * Helper function to apply noise to a price.
 * @param {number} price 
 * @param {number} noisePercent 
 * @returns {number}
 */
function _applyNoise(price, noisePercent) {
    const direction = Math.random() < 0.5 ? -1 : 1;
    const noiseAmount = price * noisePercent * direction;

    // Ensure the price doesn't drop below a reasonable minimum (e.g., 10% of base)
    const minPrice = price * 0.9;
    const obfuscatedPrice = Math.max(minPrice, price + noiseAmount);

    // Round to 2 decimal places for currency
    return Math.round(obfuscatedPrice * 100) / 100;
}

/**
 * Helper function to get a random float between min and max.
 */
function _getRandomFloat(min, max) {
    return Math.random() * (max - min) + min;
}

export default {
    applyPriceObfuscation,
    getUserConversionMetrics
};

