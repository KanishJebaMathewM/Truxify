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

    // 9. Persist to database. The table's status constraint uses 'approved'
    // (not 'verified'), requires mime_type, and has no unique
    // (driver_id, document_type) key, so an upsert with onConflict cannot work.
    if (supabaseAdmin) {
        try {
            const now = new Date().toISOString();
            const payload = {
                driver_id: driverId,
                document_type: docType,
                document_number: extractedData.document_number || null,
                storage_path: storagePath,
                mime_type: file.mimetype,
                extracted_data: extractedData,
                ocr_confidence: confidence,
                valid_until: extractedData.valid_until || null,
                status: status === 'verified' ? 'approved' : status,
                rejection_reason: status === 'rejected' ? reason : null,
                verified_at: status === 'verified' ? now : null,
                updated_at: now
            };

            const { data: existingRows, error: lookupError } = await supabaseAdmin
                .from('driver_documents')
                .select('id')
                .eq('driver_id', driverId)
                .eq('document_type', docType)
                .order('updated_at', { ascending: false })
                .limit(1);

            if (lookupError) throw lookupError;

            const existing = Array.isArray(existingRows) ? existingRows[0] : null;
            const write = existing
                ? supabaseAdmin.from('driver_documents').update(payload).eq('id', existing.id)
                : supabaseAdmin.from('driver_documents').insert(payload);
            const { error } = await write;

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

    const { data, error } = await supabaseAdmin
        .from('driver_documents')
        .update({
            status: 'approved',
            verified_at: new Date().toISOString(),
            verified_by: adminId,
            admin_notes: notes,
            rejection_reason: null
        })
        .eq('id', documentId)
        .select('id')
        .maybeSingle();

    if (error) {
        logger.error({ err: error, documentId }, 'Admin verification failed');
        throw new Error('Failed to verify document');
    }
    if (!data) {
        throw new Error('Document not found');
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
