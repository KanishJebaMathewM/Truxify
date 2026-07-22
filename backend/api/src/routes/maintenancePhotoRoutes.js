import express from 'express';
import multer from 'multer';
import { uploadMaintenancePhotos } from '../controllers/maintenancePhotoController.js';
import { authenticate } from '../middleware/auth.js';
import { requirePolicy } from '../middleware/requirePolicy.js';
import { userLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
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
