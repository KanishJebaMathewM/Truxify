/**
 * @fileoverview Core document verification service orchestrating OCR, validation, and persistence.
 */

import { supabaseAdmin } from '../config/db.js';
import logger from '../middleware/logger.js';
import { extractText, parseDocumentText, calculateConfidence, validateImageFile } from '../lib/ocrProcessor.js';
import {
    validateDocumentNumber,
    validateExtractedFields,
    checkOcrConfidence,
    checkExpiry
} from '../lib/documentValidator.js';
import { checkDriverCompliance } from '../lib/expiryTracker.js';

/**
 * Processes a document upload: validates, OCRs, and persists.
 * 
 * @param {object} params
 * @param {string} params.driverId
 * @param {string} params.docType - DL, RC, INSURANCE, etc.
 * @param {object} params.file - Multer file object
 * @param {string} params.storagePath - Supabase storage path
 * @returns {Promise<object>} Verification result
 */
export async function processDocumentUpload({ driverId, docType, file, storagePath }) {
    // 1. Validate image file
    const fileValidation = validateImageFile(file);
    if (!fileValidation.valid) {
        return { success: false, error: fileValidation.error, status: 'rejected' };
    }

    // 2. Extract text via OCR
    let ocrResult;
    try {
        ocrResult = await extractText(file.buffer, 'eng+hin');
    } catch (err) {
        logger.error({ err, driverId, docType }, 'OCR extraction failed');
        return { success: false, error: 'OCR processing failed', status: 'error' };
    }

    // 3. Check OCR confidence
    const confidence = calculateConfidence(ocrResult.words);
    if (!checkOcrConfidence(docType, confidence)) {
        return {
            success: false,
            error: `OCR confidence too low (${confidence}%). Please upload a clearer image.`,
            status: 'rejected',
            confidence
        };
    }

    // 4. Parse extracted text
    const extractedData = parseDocumentText(ocrResult.text, docType);

    // 5. Validate document number format
    if (extractedData.document_number) {
        const numValidation = validateDocumentNumber(docType, extractedData.document_number);
        if (!numValidation.valid) {
            extractedData._numberError = numValidation.error;
        } else {
            extractedData.document_number = numValidation.normalizedNumber;
        }
    }

    // 6. Validate required fields
    const fieldValidation = validateExtractedFields(docType, extractedData);

    // 7. Check expiry
    const expiryCheck = checkExpiry(extractedData.valid_until);

    // 8. Determine verification status
    let status = 'pending_review';
    let reason = null;

    if (fieldValidation.valid && !extractedData._numberError && !expiryCheck.expired) {
        status = 'verified';
    } else if (expiryCheck.expired) {
        status = 'rejected';
        reason = 'Document is expired';
    } else if (!fieldValidation.valid) {
        reason = `Missing fields: ${fieldValidation.missingFields.join(', ')}`;
    }

    // 9. Persist to database
    if (supabaseAdmin) {
        try {
            const { error } = await supabaseAdmin
                .from('driver_documents')
                .upsert({
                    driver_id: driverId,
                    document_type: docType,
                    document_number: extractedData.document_number || null,
                    storage_path: storagePath,
                    extracted_data: extractedData,
                    ocr_confidence: confidence,
                    expiry_date: extractedData.valid_until || null,
                    status: status,
                    rejection_reason: reason,
                    verified_at: status === 'verified' ? new Date().toISOString() : null,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'driver_id,document_type' });

            if (error) {
                logger.error({ err: error, driverId }, 'Failed to persist document');
                return { success: false, error: 'Database error', status: 'error' };
            }
        } catch (err) {
            logger.error({ err, driverId }, 'Unexpected error persisting document');
            return { success: false, error: 'Database error', status: 'error' };
        }
    }

    return {
        success: status === 'verified',
        status,
        reason,
        confidence,
        extractedData,
        expiryCheck
    };
}

/**
 * Admin override to manually verify a document.
 * @param {string} documentId 
 * @param {string} adminId 
 * @param {string} notes 
 */
export async function adminVerifyDocument(documentId, adminId, notes = '') {
    if (!supabaseAdmin) throw new Error('Supabase not configured');

    const { error } = await supabaseAdmin
        .from('driver_documents')
        .update({
            status: 'verified',
            verified_at: new Date().toISOString(),
            verified_by: adminId,
            admin_notes: notes,
            rejection_reason: null
        })
        .eq('id', documentId);

    if (error) {
        logger.error({ err: error, documentId }, 'Admin verification failed');
        throw new Error('Failed to verify document');
    }
}

/**
 * Gets all documents for a driver with compliance status.
 * @param {string} driverId 
 * @returns {Promise<object>}
 */
export async function getDriverDocuments(driverId) {
    if (!supabaseAdmin) return { documents: [], compliance: { compliant: false } };

    const { data, error } = await supabaseAdmin
        .from('driver_documents')
        .select('*')
        .eq('driver_id', driverId)
        .order('updated_at', { ascending: false });

    if (error) {
        logger.error({ err: error, driverId }, 'Failed to fetch driver documents');
        throw new Error('Database error');
    }

    const compliance = await checkDriverCompliance(driverId);

    return {
        documents: data || [],
        compliance
    };
}
