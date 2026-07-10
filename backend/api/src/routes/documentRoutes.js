import express from 'express';
import multer from 'multer';
import { uploadDriverDocument } from '../controllers/documentController.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = express.Router();

// Buffer the upload in memory so the content can be inspected (magic
// bytes) before anything is written to storage. 8MB covers a typical
// phone-camera photo of an ID document; PDFs are usually much smaller.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

// POST /api/driver/documents
router.post('/', authenticate, requireRole(['driver']), upload.single('document'), uploadDriverDocument);

export default router;
