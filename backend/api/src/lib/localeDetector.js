/**
 * @fileoverview Detects user locale from request headers, tokens, or defaults.
 */

import { SUPPORTED_LOCALES } from './formatters.js';

const DEFAULT_LOCALE = 'en-IN';

function normalizeLocaleValue(value) {
    if (Array.isArray(value)) value = value[0];
    if (typeof value !== 'string') return '';
    return value.trim();
}

function matchSupportedLocale(value) {
    const candidate = normalizeLocaleValue(value);
    if (!candidate) return null;
    if (SUPPORTED_LOCALES.includes(candidate)) return candidate;

    const langOnly = candidate.split('-')[0].toLowerCase();
    if (!langOnly) return null;
    return SUPPORTED_LOCALES.find((locale) => {
        const supportedLang = locale.split('-')[0].toLowerCase();
        return supportedLang === langOnly;
    }) || null;
}

/**
 * Parses the Accept-Language header and returns the best match.
 * @param {string} header - e.g., "en-US,en;q=0.9,hi-IN;q=0.8"
 * @returns {string}
 */
export function parseAcceptLanguage(header) {
    const value = normalizeLocaleValue(header);
    if (!value) return null;

    const languages = value.split(',')
        .map(lang => {
            const [code, q] = lang.trim().split(';q=');
            return {
                code: code.trim(),
                quality: q ? parseFloat(q) : 1.0
            };
        })
        .filter(({ code }) => code.length > 0)
        .sort((a, b) => {
            if (!Number.isFinite(a.quality)) return 1;
            if (!Number.isFinite(b.quality)) return -1;
            return b.quality - a.quality;
        });

    for (const { code } of languages) {
        const match = matchSupportedLocale(code);
        if (match) return match;
    }

    return null;
}

/**
 * Detects the best locale for a request.
 * Priority: Query param > User profile > Accept-Language header > Default
 * 
 * @param {object} req - Express request object
 * @returns {string} The resolved locale code
 */
export function detectLocale(req) {
    // 1. Explicit query parameter (e.g., ?lang=hi-IN)
    if (req.query && req.query.lang) {
        const queryMatch = matchSupportedLocale(req.query.lang);
        if (queryMatch) return queryMatch;
    }

    // 2. User profile preference (if authenticated)
    if (req.user && req.user.locale) {
        if (SUPPORTED_LOCALES.includes(req.user.locale)) return req.user.locale;
    }

    // 3. Custom header (often used by mobile apps)
    const customHeader = req.headers['x-locale'] || req.headers['x-language'];
    if (customHeader) {
        const headerMatch = matchSupportedLocale(customHeader);
        if (headerMatch) return headerMatch;
    }

    // 4. Accept-Language header
    const acceptLang = parseAcceptLanguage(req.headers['accept-language']);
    if (acceptLang) return acceptLang;

    // 5. Default fallback
    return DEFAULT_LOCALE;
}

/**
 * Express middleware that attaches the detected locale to req.locale.
 */
export function localeMiddleware() {
    return (req, res, next) => {
        req.locale = detectLocale(req);

        // Set Content-Language header for clients
        res.setHeader('Content-Language', req.locale);

        // Add RTL hint for frontend frameworks
        const lang = req.locale.split('-')[0];
        res.setHeader('X-Text-Direction', ['ur', 'ar'].includes(lang) ? 'rtl' : 'ltr');

        next();
    };
}

export default localeMiddleware;
