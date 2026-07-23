import { supabase } from '../config/db.js';
import logger from '../middleware/logger.js';
import {
  validateDocumentBuffer,
  DocumentValidationError,
} from '../lib/documentValidation.js';

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

    // Validate and upload each file
    for (let i = 0; i < uploadedFiles.length; i += 1) {
      const file = uploadedFiles[i];

      let verifiedMimeType;
      try {
        verifiedMimeType = validateDocumentBuffer(file.buffer, file.mimetype);
      } catch (validationError) {
        // Clean up any files already uploaded in this request
        await cleanupStorage(uploadedPaths);
        if (validationError instanceof DocumentValidationError) {
          const allowed = ALLOWED_PHOTO_MIME_TYPES.join(', ');
          return res.status(422).json({
            error: `Photo ${i + 1}: ${validationError.message}. Only ${allowed} images are accepted.`,
          });
        }
        throw validationError;
      }

      if (!ALLOWED_PHOTO_MIME_TYPES.includes(verifiedMimeType)) {
        await cleanupStorage(uploadedPaths);
        return res.status(422).json({
          error: `Photo ${i + 1}: Unsupported image type (${verifiedMimeType}). Only JPEG and PNG are accepted.`,
        });
      }

      const ext = extensionForMime(verifiedMimeType);
      const storagePath = `${driverId}/${ticketId}/${Date.now()}-${i}.${ext}`;

      const { error: storageError } = await supabase.storage
        .from('maintenance-photos')
        .upload(storagePath, file.buffer, {
          contentType: verifiedMimeType,
          upsert: false,
        });

      if (storageError) {
        logger.error('[MaintenancePhotoController] Storage upload failed:', storageError.message);
        await cleanupStorage(uploadedPaths);
        return res.status(500).json({ error: 'Failed to store photo' });
      }

      uploadedPaths.push(storagePath);
    }

    // Generate signed URLs for the uploaded files
    const photoUrls = [];
    for (const path of uploadedPaths) {
      const { data: urlData, error: urlError } = await supabase.storage
        .from('maintenance-photos')
        .createSignedUrl(path, 60 * 60 * 24 * 7); // 7-day expiry

      if (urlError) {
        logger.error('[MaintenancePhotoController] Failed to create signed URL:', urlError.message);
        await cleanupStorage(uploadedPaths);
        return res.status(500).json({ error: 'Failed to generate photo URL' });
      }

      photoUrls.push(urlData.signedUrl);
    }

    // Update the ticket with the new photo URLs
    const allUrls = [...existingUrls, ...photoUrls];
    const { error: updateError } = await supabase
      .from('truck_maintenance_tickets')
      .update({ photo_urls: allUrls })
      .eq('id', ticketId);

    if (updateError) {
      logger.error('[MaintenancePhotoController] Failed to update ticket:', updateError.message);
      await cleanupStorage(uploadedPaths);
      return res.status(500).json({ error: 'Failed to save photo references' });
    }

    return res.status(200).json({
      success: true,
      photo_urls: allUrls,
      uploaded_count: photoUrls.length,
    });
  } catch (err) {
    logger.error('[MaintenancePhotoController] Unexpected error:', err.message);
    await cleanupStorage(uploadedPaths);
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
