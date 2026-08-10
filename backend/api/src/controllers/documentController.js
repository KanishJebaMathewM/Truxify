import crypto from 'crypto';
import { supabase } from '../config/db.js';
import logger from '../middleware/logger.js';
import {
  validateDocumentBuffer,
  DocumentValidationError,
} from '../lib/documentValidation.js';
import { scanDocument, MalwareScanError } from '../lib/malwareScanner.js';

const ALLOWED_DOCUMENT_TYPES = Object.freeze([
  'aadhaar_card',
  'pan_card',
  'driving_licence',
  'rc_book',
  'other',
]);

// Mirrors the multer limit in routes/documentRoutes.js, which reads the same
// env var and falls back to the same 8MB. multer rejects oversized multipart
// bodies before the controller runs; this is the guard for the buffer itself,
// whose length can disagree with the reported size.
const MAX_FILE_SIZE_BYTES =
  Number(process.env.MULTIPART_FILE_LIMIT_BYTES) || 8 * 1024 * 1024;

// Mirrors the scanner's own deadline in lib/malwareScanner.js, so the
// AbortController below cannot fire before or long after the scanner gives up.
const SCAN_TIMEOUT_MS = Number(process.env.SCAN_TIMEOUT_MS) || 30000;

const MIME_EXTENSION_MAP = Object.freeze({
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/heic': 'heic',
});

/**
 * Handles a driver KYC document upload. The file itself is validated
 * server-side by inspecting its magic bytes (see lib/documentValidation.js)
 * rather than trusting the client-supplied extension or Content-Type, then
 * stored in the private driver-documents storage bucket with a metadata
 * row recording who uploaded it and its verified type.
 */
export async function uploadDriverDocument(req, res) {
  try {
    const driverId = req.user?.id;
    if (!driverId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'A document file is required' });
    }

    // Guard against oversized buffers before CPU/memory intensive operations
    if (req.file.size > MAX_FILE_SIZE_BYTES || req.file.buffer?.length > MAX_FILE_SIZE_BYTES) {
      return res.status(413).json({
        error: `File size exceeds the maximum allowed limit of ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB.`,
      });
    }

    const documentType = req.body?.documentType;
    if (!documentType || !ALLOWED_DOCUMENT_TYPES.includes(documentType)) {
      return res.status(400).json({
        error: `documentType must be one of: ${ALLOWED_DOCUMENT_TYPES.join(', ')}`,
      });
    }

    let verifiedMimeType;
    try {
      verifiedMimeType = validateDocumentBuffer(req.file.buffer, req.file.mimetype);
    } catch (validationError) {
      if (validationError instanceof DocumentValidationError) {
        return res.status(422).json({ error: validationError.message });
      }
      throw validationError;
    }

    // Malware Scanning Block with AbortController Timeout Guard
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);

    try {
      // Pass signal to scanDocument if supported, and race against an abort promise
      const scanPromise = scanDocument(req.file.buffer, req.file.originalname, {
        signal: controller.signal,
      });

      const abortPromise = new Promise((_, reject) => {
        controller.signal.addEventListener('abort', () => {
          const timeoutErr = new Error('Malware scanning timed out');
          timeoutErr.name = 'TimeoutError';
          reject(timeoutErr);
        });
      });

      const scanResult = await Promise.race([scanPromise, abortPromise]);

      if (!scanResult.clean) {
        return res.status(422).json({
          error: 'Uploaded document failed malware scanning.',
        });
      }
    } catch (scanError) {
      if (scanError.name === 'TimeoutError' || scanError.name === 'AbortError') {
        logger.error(
          { driverId, documentType, timeoutMs: SCAN_TIMEOUT_MS },
          '[DocumentController] Malware scanner timed out',
        );
        return res.status(504).json({
          error: 'Malware scan service timed out. Please try again.',
        });
      }

      if (scanError instanceof MalwareScanError) {
        logger.warn(
          { driverId, documentType, reason: scanError.message },
          '[DocumentController] Upload rejected by malware scanner',
        );
        return res.status(422).json({
          error: scanError.message,
        });
      }
      throw scanError;
    } finally {
      clearTimeout(timeoutId);
    }

    const extension = MIME_EXTENSION_MAP[verifiedMimeType];
    if (!extension) {
      return res.status(422).json({
        error: `Unsupported file extension for MIME type: ${verifiedMimeType}`,
      });
    }

    // A driver re-uploading the same document type supersedes the previous
    // one: the metadata row below is updated in place and the superseded file
    // removed once the new row is committed. Ordered newest-first and limited
    // to one row because there is no unique constraint on
    // (driver_id, document_type) — see the create_driver_documents migration.
    const { data: existingDoc, error: lookupError } = await supabase
      .from('driver_documents')
      .select('id, storage_path')
      .eq('driver_id', driverId)
      .eq('document_type', documentType)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lookupError) {
      logger.error(
        '[DocumentController] Failed to look up existing document:',
        lookupError.message,
      );
      return res.status(500).json({ error: 'Failed to store document' });
    }

    // Captured before the row is updated below: the update rewrites
    // storage_path, so reading it afterwards would point at the file that was
    // just uploaded rather than the one being replaced.
    const supersededStoragePath = existingDoc?.storage_path ?? null;

    const storagePath = `${driverId}/${documentType}-${Date.now()}.${extension}`;

    const { error: storageError } = await supabase.storage
      .from('driver-documents')
      .upload(storagePath, req.file.buffer, {
        contentType: verifiedMimeType,
        upsert: false,
      });

    if (storageError) {
      logger.error('[DocumentController] Failed to upload document to storage:', storageError.message);
      return res.status(500).json({ error: 'Failed to store document' });
    }

    let record;
    let dbError;

    if (existingDoc) {
      // Update existing record (Supersede)
      const { data: updatedRecord, error: updateErr } = await supabase
        .from('driver_documents')
        .update({
          storage_path: storagePath,
          mime_type: verifiedMimeType,
          status: 'pending_review',
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingDoc.id)
        .select('id, document_type, status, created_at')
        .single();

      record = updatedRecord;
      dbError = updateErr;
    } else {
      // Insert new document record
      const { data: insertedRecord, error: insertErr } = await supabase
        .from('driver_documents')
        .insert({
          driver_id: driverId,
          document_type: documentType,
          storage_path: storagePath,
          mime_type: verifiedMimeType,
          status: 'pending_review',
        })
        .select('id, document_type, status, created_at')
        .single();

      record = insertedRecord;
      dbError = insertErr;
    }

    if (dbError) {
      logger.error('[DocumentController] Failed to record document metadata:', dbError.message);
      await supabase.storage.from('driver-documents').remove([storagePath]).catch((storageCleanErr) => {
        logger.error('[DocumentController] Failed to clean up document storage path:', storageCleanErr.message);
      });

      // Handle Postgres unique constraint violation explicitly (HTTP 409 Conflict)
      if (dbError.code === '23505') {
        return res.status(409).json({
          error: `A document of type '${documentType}' already exists for this driver.`,
        });
      }

      return res.status(500).json({ error: 'Failed to store document' });
    }

    // Clean up old file from storage to prevent orphaned files
    if (supersededStoragePath) {
      await supabase.storage
        .from('driver-documents')
        .remove([supersededStoragePath])
        .catch((cleanupErr) => {
          logger.warn('[DocumentController] Failed to delete superseded storage file:', cleanupErr.message);
        });
    }

    return res.status(existingDoc ? 200 : 201).json({
      success: true,
      document: record,
    });
  } catch (err) {
    logger.error('[DocumentController] Unexpected error in uploadDriverDocument:', err.message);
    return res.status(500).json({ error: 'An unexpected error occurred' });
  }
}