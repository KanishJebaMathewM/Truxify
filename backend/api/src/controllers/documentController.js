import { supabase } from '../config/db.js';
import logger from '../middleware/logger.js';
import {
  validateDocumentBuffer,
  DocumentValidationError,
} from '../lib/documentValidation.js';

const ALLOWED_DOCUMENT_TYPES = Object.freeze([
  'aadhaar_card',
  'pan_card',
  'driving_licence',
  'rc_book',
  'other',
]);

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

    const documentType = req.body?.documentType;
    if (!documentType || !ALLOWED_DOCUMENT_TYPES.includes(documentType)) {
      return res.status(400).json({
        error: `documentType must be one of: ${ALLOWED_DOCUMENT_TYPES.join(', ')}`,
      });
    }

    let verifiedMimeType;
    try {
      verifiedMimeType = validateDocumentBuffer(req.file.buffer, req.file.mimetype);
      const scanResult = await scanDocument(req.file.buffer);

      if (!scanResult.clean) {
        return res.status(422).json({
          error: 'Uploaded document failed malware scanning.',
        });
      }
    } catch (validationError) {
      if (validationError instanceof DocumentValidationError) {
        return res.status(422).json({ error: validationError.message });
      }
      throw validationError;
    }

    const extension = verifiedMimeType === 'application/pdf' ? 'pdf'
      : verifiedMimeType === 'image/png' ? 'png'
      : 'jpg';
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

    const { data: record, error: insertError } = await supabase
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

    if (insertError) {
      logger.error('[DocumentController] Failed to record document metadata:', insertError.message);
      await supabase.storage.from('driver-documents').remove([storagePath]).catch((storageCleanErr) => {
        logger.error('[DocumentController] Failed to clean up document storage path:', storageCleanErr.message);
      });
      return res.status(500).json({ error: 'Failed to store document' });
    }

    return res.status(201).json({
      success: true,
      document: record,
    });
  } catch (err) {
    logger.error('[DocumentController] Unexpected error in uploadDriverDocument:', err.message);
    return res.status(500).json({ error: 'An unexpected error occurred' });
  }
}
