/**
 * @fileoverview Locale-aware formatting for dates, numbers, and currencies.
 * Uses Intl API for accurate localization.
 */

const SUPPORTED_LOCALES = [
    'en-IN', 'hi-IN', 'ta-IN', 'te-IN', 'bn-IN',
    'mr-IN', 'gu-IN', 'kn-IN', 'ml-IN', 'pa-IN', 'ur-IN'
];

/**
 * Formats a number according to the locale.
 * @param {number} value 
 * @param {string} locale 
 * @returns {string}
 */
export function formatNumber(value, locale = 'en-IN') {
    try {
        return new Intl.NumberFormat(locale).format(value);
    } catch {
        return String(value);
    }
}

/**
 * Formats a currency value (default INR).
 * @param {number} value - Amount in main units (e.g., Rupees, not paisa)
 * @param {string} locale 
 * @param {string} currency 
 * @returns {string}
 */
export function formatCurrency(value, locale = 'en-IN', currency = 'INR') {
    try {
        return new Intl.NumberFormat(locale, {
            style: 'currency',
            currency,
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
        }).format(value);
    } catch {
        return `₹${value}`;
    }
}

/**
 * Formats a date according to the locale.
 * @param {Date|string|number} date 
 * @param {string} locale 
 * @param {object} options - Intl.DateTimeFormatOptions
 * @returns {string}
 */
export function formatDate(date, locale = 'en-IN', options = {}) {
    try {
        const dateObj = date instanceof Date ? date : new Date(date);
        const defaultOptions = {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            ...options
        };
        return new Intl.DateTimeFormat(locale, defaultOptions).format(dateObj);
    } catch {
        return String(date);
    }
}

/**
 * Formats a date with time.
 * @param {Date|string|number} date 
 * @param {string} locale 
 * @returns {string}
 */
export function formatDateTime(date, locale = 'en-IN') {
    return formatDate(date, locale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

/**
 * Formats a relative time (e.g., "2 hours ago").
 * @param {Date|string|number} date 
 * @param {string} locale 
 * @returns {string}
 */
export function formatRelativeTime(date, locale = 'en-IN') {
    try {
        const dateObj = date instanceof Date ? date : new Date(date);
        const now = new Date();
        const diffMs = now - dateObj;
        const diffSec = Math.round(diffMs / 1000);
        const diffMin = Math.round(diffSec / 60);
        const diffHour = Math.round(diffMin / 60);
        const diffDay = Math.round(diffHour / 24);

        const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

        if (Math.abs(diffSec) < 60) return rtf.format(-diffSec, 'second');
        if (Math.abs(diffMin) < 60) return rtf.format(-diffMin, 'minute');
        if (Math.abs(diffHour) < 24) return rtf.format(-diffHour, 'hour');
        if (Math.abs(diffDay) < 30) return rtf.format(-diffDay, 'day');

        return formatDate(dateObj, locale);
    } catch {
        return String(date);
    }
}

/**
 * Checks if a locale is RTL (Right-to-Left).
 * @param {string} locale 
 * @returns {boolean}
 */
export function isRTL(locale) {
    const rtlLocales = ['ur', 'ar', 'he', 'fa'];
    const lang = locale.split('-')[0].toLowerCase();
    return rtlLocales.includes(lang);
}

export { SUPPORTED_LOCALES };
