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

// POST /api/maintenance/:ticketId/photos
router.post(
  '/:ticketId/photos',
  authenticate,
  userLimiter,
  requirePolicy('maintenance:upload-photos'),
  upload.array('photos', 3),
  uploadMaintenancePhotos,
);

export default router;
