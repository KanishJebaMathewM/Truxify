/**
 * @fileoverview ICU MessageFormat pluralization engine.
 * Supports complex plural rules for Indian languages and English.
 */

const PLURAL_RULES = {
    en: (n) => n === 1 ? 'one' : 'other',
    hi: (n) => n === 0 || n === 1 ? 'one' : 'other',
    ta: (n) => n === 1 ? 'one' : 'other',
    te: (n) => n === 1 ? 'one' : 'other',
    bn: (n) => n === 0 || n === 1 ? 'one' : 'other',
    mr: (n) => n === 1 ? 'one' : 'other',
    gu: (n) => n === 1 ? 'one' : 'other',
    kn: (n) => n === 1 ? 'one' : 'other',
    ml: (n) => n === 1 ? 'one' : 'other',
    pa: (n) => n === 0 || n === 1 ? 'one' : 'other',
    ur: (n) => n === 1 ? 'one' : 'other',
    ar: (n) => {
        if (n === 0) return 'zero';
        if (n === 1) return 'one';
        if (n === 2) return 'two';
        const mod100 = n % 100;
        if (mod100 >= 3 && mod100 <= 10) return 'few';
        if (mod100 >= 11 && mod100 <= 99) return 'many';
        return 'other';
    }
};

/**
 * Resolves the plural category for a number in a given locale.
 * @param {number} count 
 * @param {string} locale 
 * @returns {string} 'zero', 'one', 'two', 'few', 'many', or 'other'
 */
export function getPluralCategory(count, locale) {
    const rule = PLURAL_RULES[locale] || PLURAL_RULES.en;
    return rule(Math.abs(count));
}

/**
 * Selects the correct plural string from a dictionary.
 * 
 * @param {number} count 
 * @param {object} forms - e.g., { one: '{count} item', other: '{count} items' }
 * @param {string} locale 
 * @returns {string} The selected template string
 */
export function pluralize(count, forms, locale) {
    if (!forms || typeof forms !== 'object') return '';

    const category = getPluralCategory(count, locale);

    // Fallback chain: exact category -> 'other' -> first available
    let template = forms[category] || forms.other;

    if (!template) {
        const keys = Object.keys(forms);
        template = keys.length > 0 ? forms[keys[0]] : '';
    }

    // Simple variable replacement
    return template.replace(/\{count\}/g, String(count));
}

/**
 * Parses an ICU-like message with simple variables.
 * @param {string} message - e.g., "Hello {name}, you have {count} orders"
 * @param {object} variables - e.g., { name: 'John', count: 5 }
 * @returns {string}
 */
export function formatMessage(message, variables = {}) {
    if (!message) return '';

    return message.replace(/\{(\w+)\}/g, (match, key) => {
        return variables[key] !== undefined ? String(variables[key]) : match;
    });
}
