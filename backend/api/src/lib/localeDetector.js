/**
 * @fileoverview Detects user locale from request headers, tokens, or defaults.
 */

import { SUPPORTED_LOCALES } from './formatters.js';

const DEFAULT_LOCALE = 'en-IN';

/**
 * Parses the Accept-Language header and returns the best match.
 * @param {string} header - e.g., "en-US,en;q=0.9,hi-IN;q=0.8"
 * @returns {string}
 */
export function parseAcceptLanguage(header) {
    if (!header) return null;

    const languages = header.split(',')
        .map(lang => {
            const [code, q] = lang.trim().split(';q=');
            return {
                code: code.trim(),
                quality: q ? parseFloat(q) : 1.0
            };
        })
        .sort((a, b) => b.quality - a.quality);

    for (const { code } of languages) {
        // Exact match
        if (SUPPORTED_LOCALES.includes(code)) return code;

        // Language-only match (e.g., 'hi' -> 'hi-IN')
        const langOnly = code.split('-')[0];
        const match = SUPPORTED_LOCALES.find(l => l.startsWith(langOnly));
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
        const queryLang = req.query.lang;
        if (SUPPORTED_LOCALES.includes(queryLang)) return queryLang;
        const langMatch = SUPPORTED_LOCALES.find(l => l.startsWith(queryLang.split('-')[0]));
        if (langMatch) return langMatch;
    }

    // 2. User profile preference (if authenticated)
    if (req.user && req.user.locale) {
        if (SUPPORTED_LOCALES.includes(req.user.locale)) return req.user.locale;
    }

    // 3. Custom header (often used by mobile apps)
    const customHeader = req.headers['x-locale'] || req.headers['x-language'];
    if (customHeader) {
        if (SUPPORTED_LOCALES.includes(customHeader)) return customHeader;
        const headerMatch = SUPPORTED_LOCALES.find(l => l.startsWith(customHeader.split('-')[0]));
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
