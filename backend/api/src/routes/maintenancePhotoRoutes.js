import express from 'express';
import multer from 'multer';
import { uploadMaintenancePhotos } from '../controllers/maintenancePhotoController.js';
import { authenticate } from '../middleware/auth.js';
import { requirePolicy } from '../middleware/requirePolicy.js';
import { userLimiter } from '../middleware/rateLimiter.js';
import { ALLOWED_DOCUMENT_MIME_TYPES } from '../lib/documentValidation.js';

const router = express.Router();

// Photos only — the controller re-checks the actual bytes, but rejecting on
// the declared type here avoids buffering 8MB of non-image content first.
const ALLOWED_PHOTO_MIME_TYPES = ALLOWED_DOCUMENT_MIME_TYPES.filter(
  (mime) => mime.startsWith('image/')
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, ALLOWED_PHOTO_MIME_TYPES.includes(file.mimetype));
  },
});

function requireUploadedPhotos(req, res, next) {
  if (Array.isArray(req.files) && req.files.length > 0) return next();
  return res.status(400).json({
    error: 'At least one photo file is required. Only JPEG and PNG images are accepted.',
  });
}

// POST /api/maintenance/:ticketId/photos
router.post(
  '/:ticketId/photos',
  authenticate,
  userLimiter,
  requirePolicy('maintenance:upload-photos'),
  upload.array('photos', 3),
  requireUploadedPhotos,
  uploadMaintenancePhotos,
);

export default router;
