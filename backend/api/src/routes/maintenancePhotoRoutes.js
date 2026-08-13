import express from 'express';
import multer from 'multer';
import { uploadMaintenancePhotos } from '../controllers/maintenancePhotoController.js';
import { authenticate } from '../middleware/auth.js';
import { requirePolicy } from '../middleware/requirePolicy.js';
import { userLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// Photos only — must match the controller's ALLOWED_PHOTO_MIME_TYPES exactly.
// Rejecting on the declared type here avoids buffering 8MB of a file that is
// guaranteed to be rejected (422) after upload.
const ALLOWED_PHOTO_MIME_TYPES = Object.freeze([
  'image/jpeg',
  'image/png',
]);

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
