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
        requiredFields: ['name', 'dob', 'validity'],
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
export function checkExpiry(expiryDate, warningDays = 30) {
    if (!expiryDate) {
        return { expired: false, daysUntilExpiry: null, warning: false };
    }

    const expiry = new Date(expiryDate);
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
