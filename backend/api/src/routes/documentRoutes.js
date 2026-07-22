import express from 'express';
import multer from 'multer';
import { uploadDriverDocument } from '../controllers/documentController.js';
import { authenticate } from '../middleware/auth.js';
import { requirePolicy } from '../middleware/requirePolicy.js';
import { userLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// Buffer the upload in memory so the content can be inspected (magic
// bytes) before anything is written to storage. 8MB covers a typical
// phone-camera photo of an ID document; PDFs are usually much smaller.
const uploadFileLimit =
  Number(process.env.MULTIPART_FILE_LIMIT_BYTES) ||
  8 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: uploadFileLimit,
  },
});

// POST /api/driver/documents
router.post('/', authenticate, userLimiter, requirePolicy('document:upload'), upload.single('document'), uploadDriverDocument);

export default router;
