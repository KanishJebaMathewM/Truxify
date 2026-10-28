/**
 * @fileoverview Document format validation and checksum verification.
 * Validates structure of Indian compliance documents before OCR.
 */

import logger from '../middleware/logger.js';

/**
 * Validation rules for different document types.
 */
const DOCUMENT_RULES = {
    DL: {
        name: 'Driving License',
        numberRegex: /^[A-Z]{2}[0-9]{2}\s?[0-9]{11}$/, // e.g., MH0120110000001
        requiredFields: ['name', 'dob', 'valid_until'],
        minOcrConfidence: 70
    },
    RC: {
        name: 'Registration Certificate',
        numberRegex: /^[A-Z]{2}[0-9]{2}\s?[A-Z]{1,3}\s?[0-9]{4}$/, // e.g., MH01AB1234
        requiredFields: ['owner_name', 'registration_date', 'vehicle_class'],
        minOcrConfidence: 75
    },
    INSURANCE: {
        name: 'Insurance Policy',
        numberRegex: /^[A-Z0-9]{8,20}$/,
        requiredFields: ['policy_number', 'valid_from', 'valid_until'],
        minOcrConfidence: 65
    },
    FITNESS: {
        name: 'Fitness Certificate',
        numberRegex: /^[A-Z0-9]{6,15}$/,
        requiredFields: ['certificate_number', 'valid_until'],
        minOcrConfidence: 70
    },
    PUC: {
        name: 'Pollution Under Control',
        numberRegex: /^[A-Z0-9]{8,15}$/,
        requiredFields: ['puc_number', 'valid_until'],
        minOcrConfidence: 60
    },
    PERMIT: {
        name: 'Transport Permit',
        numberRegex: /^[A-Z0-9]{6,20}$/,
        requiredFields: ['permit_number', 'valid_until', 'route'],
        minOcrConfidence: 70
    }
};

/**
 * Validates a document number format.
 * @param {string} docType 
 * @param {string} docNumber 
 * @returns {{valid: boolean, error?: string}}
 */
export function validateDocumentNumber(docType, docNumber) {
    if (!docNumber || typeof docNumber !== 'string') {
        return { valid: false, error: 'Document number is required' };
    }

    const rules = DOCUMENT_RULES[docType];
    if (!rules) {
        return { valid: false, error: `Unknown document type: ${docType}` };
    }

    const cleanNumber = docNumber.trim().toUpperCase().replace(/\s+/g, ' ');

    if (!rules.numberRegex.test(cleanNumber)) {
        return {
            valid: false,
            error: `Invalid ${rules.name} number format. Expected pattern: ${rules.numberRegex}`
        };
    }

    return { valid: true, normalizedNumber: cleanNumber };
}

/**
 * Validates that OCR extracted all required fields.
 * @param {string} docType 
 * @param {object} extractedData 
 * @returns {{valid: boolean, missingFields: string[]}}
 */
export function validateExtractedFields(docType, extractedData) {
    const rules = DOCUMENT_RULES[docType];
    if (!rules) return { valid: false, missingFields: ['unknown_doc_type'] };

    const missing = [];

    for (const field of rules.requiredFields) {
        if (!extractedData[field] || String(extractedData[field]).trim() === '') {
            missing.push(field);
        }
    }

    return {
        valid: missing.length === 0,
        missingFields: missing
    };
}

/**
 * Checks if OCR confidence meets minimum threshold.
 * @param {string} docType 
 * @param {number} confidence - 0-100
 * @returns {boolean}
 */
export function checkOcrConfidence(docType, confidence) {
    const rules = DOCUMENT_RULES[docType];
    if (!rules) return false;

    return confidence >= rules.minOcrConfidence;
}

/**
 * Validates expiry date is in the future.
 * @param {string} expiryDate - ISO date string
 * @param {number} warningDays - Days before expiry to warn
 * @returns {{expired: boolean, daysUntilExpiry: number, warning: boolean}}
 */
function parseCalendarDate(value) {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }
    if (typeof value !== 'string') return null;

    const text = value.trim();
    let year;
    let month;
    let day;

    // OCR output is commonly day-first (31/12/2035) while storage and APIs
    // use ISO. `new Date('31/12/2035')` is invalid and made every real
    // document look expired.
    let match = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/.exec(text);
    if (match) {
        year = Number(match[1]);
        month = Number(match[2]);
        day = Number(match[3]);
    } else {
        match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
        if (!match) return null;
        day = Number(match[1]);
        month = Number(match[2]);
        year = Number(match[3]);
    }

    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
        parsed.getUTCFullYear() !== year ||
        parsed.getUTCMonth() !== month - 1 ||
        parsed.getUTCDate() !== day
    ) {
        return null;
    }
    return parsed;
}

export function checkExpiry(expiryDate, warningDays = 30) {
    // A missing or unparseable expiry date must never be treated as valid.
    // `new Date('not-a-date')` produces an invalid Date whose NaN timestamp
    // makes every comparison false, which previously returned expired:false
    // and let an unreadable document pass verification.
    if (!expiryDate) {
        return { expired: true, daysUntilExpiry: null, warning: false, reason: 'missing_expiry' };
    }

    const expiry = parseCalendarDate(expiryDate);
    if (!expiry) {
        return { expired: true, daysUntilExpiry: null, warning: false, reason: 'invalid_expiry' };
    }

    const now = new Date();
    const diffMs = expiry.getTime() - now.getTime();
    const daysUntilExpiry = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    return {
        expired: daysUntilExpiry <= 0,
        daysUntilExpiry,
        warning: daysUntilExpiry > 0 && daysUntilExpiry <= warningDays
    };
}

/**
 * Gets document type metadata.
 * @param {string} docType 
 * @returns {object}
 */
export function getDocumentRules(docType) {
    return DOCUMENT_RULES[docType] || null;
}

export { DOCUMENT_RULES };
