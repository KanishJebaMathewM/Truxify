/**
 * @fileoverview Core i18n service for loading, caching, and resolving translations.
 */

import { supabaseAdmin, redisClient } from '../config/db.js';
import logger from '../middleware/logger.js';
import { pluralize, formatMessage } from '../lib/pluralizer.js';
import {
    formatNumber,
    formatCurrency,
    formatDate,
    formatDateTime,
    isRTL,
    SUPPORTED_LOCALES
} from '../lib/formatters.js';

const CACHE_PREFIX = 'i18n:translations:';
const CACHE_TTL_SECONDS = 3600; // 1 hour
export const MEMORY_CACHE_TTL_MS = CACHE_TTL_SECONDS * 1000;
export const MAX_MEMORY_CACHE_ENTRIES = 100;

// In-memory cache for fast access: locale -> { dict, cachedAt }
const memoryCache = new Map();

export function isSupportedLocale(locale) {
    return typeof locale === 'string' && SUPPORTED_LOCALES.includes(locale);
}

function pruneMemoryCache(now = Date.now()) {
    for (const [locale, entry] of memoryCache) {
        if (now - entry.cachedAt > MEMORY_CACHE_TTL_MS) {
            memoryCache.delete(locale);
        }
    }
}

function setMemoryCache(locale, dict, now = Date.now()) {
    pruneMemoryCache(now);
    if (!memoryCache.has(locale) && memoryCache.size >= MAX_MEMORY_CACHE_ENTRIES) {
        const oldest = memoryCache.keys().next().value;
        if (oldest !== undefined) memoryCache.delete(oldest);
    }
    // Re-insert so Map iteration order tracks least-recently-used entries.
    memoryCache.delete(locale);
    memoryCache.set(locale, { dict, cachedAt: now });
}

/**
 * Loads translations for a specific locale from Supabase, with Redis/memory caching.
 * @param {string} locale 
 * @returns {Promise<object>} Translation dictionary
 */
export async function loadTranslations(locale) {
    if (!isSupportedLocale(locale)) {
        return {};
    }

    // 1. Check memory cache
    const now = Date.now();
    pruneMemoryCache(now);
    const cachedEntry = memoryCache.get(locale);
    if (cachedEntry) {
        // Re-insert for LRU ordering without extending the fixed TTL.
        memoryCache.delete(locale);
        memoryCache.set(locale, cachedEntry);
        return cachedEntry.dict;
    }

    // 2. Check Redis cache
    if (redisClient && redisClient.status === 'ready') {
        try {
            const cached = await redisClient.get(`${CACHE_PREFIX}${locale}`);
            if (cached) {
                const parsed = JSON.parse(cached);
                setMemoryCache(locale, parsed);
                return parsed;
            }
        } catch (err) {
            logger.warn({ err, locale }, 'Redis i18n cache read failed');
        }
    }

    // 3. Fetch from Supabase
    if (!supabaseAdmin) {
        logger.error('Supabase not configured for i18n');
        return {};
    }

    try {
        const { data, error } = await supabaseAdmin
            .from('translations')
            .select('key, value, plural_forms')
            .eq('locale', locale);

        if (error) throw error;

        const dict = {};
        for (const row of (data || [])) {
            if (row.plural_forms) {
                try {
                    dict[row.key] = JSON.parse(row.plural_forms);
                } catch {
                    dict[row.key] = row.value;
                }
            } else {
                dict[row.key] = row.value;
            }
        }

        // Populate caches
        setMemoryCache(locale, dict);
        if (redisClient && redisClient.status === 'ready') {
            try {
                await redisClient.set(
                    `${CACHE_PREFIX}${locale}`,
                    JSON.stringify(dict),
                    'EX',
                    CACHE_TTL_SECONDS
                );
            } catch (err) {
                logger.warn({ err, locale }, 'Redis i18n cache write failed');
            }
        }

        return dict;
    } catch (err) {
        logger.error({ err, locale }, 'Failed to load translations from DB');
        return {};
    }
}

/**
 * Translates a key with variable interpolation and pluralization.
 * 
 * @param {string} key - Translation key (e.g., 'orders.count')
 * @param {object} variables - Interpolation variables (e.g., { count: 5 })
 * @param {string} locale - Target locale
 * @param {string} fallback - Fallback string if key not found
 * @returns {Promise<string>}
 */
export async function translate(key, variables = {}, locale = 'en-IN', fallback = null) {
    const dict = await loadTranslations(locale);
    let template = dict[key];

    // Fallback to English if missing
    if (!template && locale !== 'en-IN') {
        const enDict = await loadTranslations('en-IN');
        template = enDict[key];
    }

    // Final fallback
    if (!template) {
        return fallback || key;
    }

    // Handle pluralization if template is an object
    if (typeof template === 'object' && variables.count !== undefined) {
        template = pluralize(variables.count, template, locale.split('-')[0]);
    }

    // Format variables before interpolation
    const formattedVars = { ...variables };
    if (formattedVars.count !== undefined) {
        formattedVars.countFormatted = formatNumber(formattedVars.count, locale);
    }
    if (formattedVars.amount !== undefined) {
        formattedVars.amountFormatted = formatCurrency(formattedVars.amount, locale);
    }

    return formatMessage(template, formattedVars);
}

/**
 * Clears the translation cache for a locale (or all locales).
 * @param {string} locale - Optional specific locale
 */
export async function clearTranslationCache(locale = null) {
    if (locale) {
        memoryCache.delete(locale);
        if (redisClient && redisClient.status === 'ready') {
            await redisClient.del(`${CACHE_PREFIX}${locale}`).catch(() => { });
        }
    } else {
        memoryCache.clear();
        if (redisClient && redisClient.status === 'ready') {
            const keys = await redisClient.keys(`${CACHE_PREFIX}*`).catch(() => []);
            if (keys.length > 0) {
                await redisClient.del(...keys).catch(() => { });
            }
        }
    }
}

/**
 * Formats a response payload with localized strings.
 * @param {object} payload 
 * @param {string} locale 
 * @returns {Promise<object>}
 */
export async function localizeResponse(payload, locale) {
    if (!payload || typeof payload !== 'object') return payload;

    const localized = { ...payload };

    // Translate error messages if present
    if (localized.error && typeof localized.error === 'string') {
        localized.error = await translate(`errors.${localized.error}`, {}, locale, localized.error);
    }

    if (localized.message && typeof localized.message === 'string') {
        localized.message = await translate(`messages.${localized.message}`, {}, locale, localized.message);
    }

    // Add locale metadata
    localized._locale = locale;
    localized._rtl = isRTL(locale);

    return localized;
}
