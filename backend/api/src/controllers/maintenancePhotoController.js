import { randomUUID } from 'node:crypto';
import { supabase } from '../config/db.js';
import logger from '../middleware/logger.js';
import {
  validateDocumentBuffer,
  DocumentValidationError,
} from '../lib/documentValidation.js';
import { scanDocument, MalwareScanError } from '../lib/malwareScanner.js';

const ALLOWED_PHOTO_MIME_TYPES = Object.freeze([
  'image/jpeg',
  'image/png',
]);

const MAX_PHOTOS = 3;

function extensionForMime(mime) {
  if (mime === 'image/png') return 'png';
  return 'jpg';
}

export async function uploadMaintenancePhotos(req, res) {
  const uploadedPaths = [];

  try {
    const driverId = req.user?.id;
    if (!driverId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const { ticketId } = req.params;
    if (!ticketId) {
      return res.status(400).json({ error: 'ticketId is required' });
    }

    const uploadedFiles = Array.isArray(req.files) ? req.files : [];

    if (uploadedFiles.length === 0) {
      return res.status(400).json({ error: 'At least one photo file is required' });
    }

    if (uploadedFiles.length > MAX_PHOTOS) {
      return res.status(400).json({ error: `Maximum ${MAX_PHOTOS} photos allowed` });
    }

    // Verify ticket exists and belongs to this driver
    const { data: ticket, error: ticketError } = await supabase
      .from('truck_maintenance_tickets')
      .select('id, driver_id, photo_urls')
      .eq('id', ticketId)
      .maybeSingle();

    if (ticketError) {
      logger.error('[MaintenancePhotoController] Failed to fetch ticket:', ticketError.message);
      return res.status(500).json({ error: 'Failed to verify ticket' });
    }

    if (!ticket) {
      return res.status(404).json({ error: 'Maintenance ticket not found' });
    }

    if (ticket.driver_id !== driverId) {
      return res.status(403).json({ error: 'You do not have permission to upload photos to this ticket' });
    }

    const existingUrls = ticket.photo_urls || [];
    if (existingUrls.length + uploadedFiles.length > MAX_PHOTOS) {
      return res.status(400).json({
        error: `Ticket already has ${existingUrls.length} photo(s). Maximum ${MAX_PHOTOS} allowed.`,
      });
    }

    // Validate, scan, and upload files in parallel
    const uploadResults = await Promise.all(
      uploadedFiles.map(async (file, i) => {
        let verifiedMimeType;
        try {
          verifiedMimeType = validateDocumentBuffer(file.buffer, file.mimetype);
        } catch (validationError) {
          if (validationError instanceof DocumentValidationError) {
            const allowed = ALLOWED_PHOTO_MIME_TYPES.join(', ');
            const errObj = new Error(`Photo ${i + 1}: ${validationError.message}. Only ${allowed} images are accepted.`);
            errObj.statusCode = 422;
            throw errObj;
          }
          throw validationError;
        }

        if (!ALLOWED_PHOTO_MIME_TYPES.includes(verifiedMimeType)) {
          const errObj = new Error(`Photo ${i + 1}: Unsupported image type (${verifiedMimeType}). Only JPEG and PNG are accepted.`);
          errObj.statusCode = 422;
          throw errObj;
        }

        try {
          const scanResult = await scanDocument(file.buffer);
          if (!scanResult.clean) {
            const errObj = new Error(`Photo ${i + 1}: Uploaded file failed malware scanning.`);
            errObj.statusCode = 422;
            throw errObj;
          }
        } catch (scanError) {
          if (scanError instanceof MalwareScanError) {
            logger.warn(
              { driverId, ticketId, photoIndex: i, reason: scanError.message },
              '[MaintenancePhotoController] Upload rejected by malware scanner',
            );
            const errObj = new Error(`Photo ${i + 1}: ${scanError.message}`);
            errObj.statusCode = 422;
            throw errObj;
          }
          throw scanError;
        }

        const ext = extensionForMime(verifiedMimeType);
        const storagePath = `${driverId}/${ticketId}/${Date.now()}-${randomUUID()}.${ext}`;

        const { error: storageError } = await supabase.storage
          .from('maintenance-photos')
          .upload(storagePath, file.buffer, {
            contentType: verifiedMimeType,
            upsert: false,
          });

        if (storageError) {
          logger.error('[MaintenancePhotoController] Storage upload failed:', storageError.message);
          const errObj = new Error('Failed to store photo');
          errObj.statusCode = 500;
          throw errObj;
        }

        uploadedPaths.push(storagePath);
        return storagePath;
      })
    );

    // Generate signed URLs for the uploaded files in parallel
    const photoUrls = await Promise.all(
      uploadResults.map(async (path) => {
        const { data: urlData, error: urlError } = await supabase.storage
          .from('maintenance-photos')
          .createSignedUrl(path, 60 * 60 * 24 * 7); // 7-day expiry

        if (urlError) {
          logger.error('[MaintenancePhotoController] Failed to create signed URL:', urlError.message);
          const errObj = new Error('Failed to generate photo URL');
          errObj.statusCode = 500;
          throw errObj;
        }

        return urlData.signedUrl;
      })
    );

    // Update the ticket with the new photo PATHS (not ephemeral URLs)
    const allPaths = [...existingUrls, ...uploadedPaths];
    const { error: updateError } = await supabase
      .from('truck_maintenance_tickets')
      .update({ photo_urls: allPaths })
      .eq('id', ticketId);

    if (updateError) {
      logger.error('[MaintenancePhotoController] Failed to update ticket:', updateError.message);
      await cleanupStorage(uploadedPaths);
      return res.status(500).json({ error: 'Failed to save photo references' });
    }

    return res.status(200).json({
      success: true,
      photo_urls: [...existingUrls, ...photoUrls], // Return signed URLs to the client for immediate rendering
      uploaded_count: photoUrls.length,
    });
  } catch (err) {
    if (uploadedPaths.length > 0) {
      await cleanupStorage(uploadedPaths);
    }
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    logger.error('[MaintenancePhotoController] Unexpected error:', err.message);
    return res.status(500).json({ error: 'An unexpected error occurred' });
  }
}

async function cleanupStorage(paths) {
  if (paths.length === 0) return;
  try {
    await supabase.storage.from('maintenance-photos').remove(paths);
  } catch (err) {
    logger.error('[MaintenancePhotoController] Storage cleanup failed:', err.message);
  }
}
