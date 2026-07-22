/**
 * @openapi
 * components:
 *   schemas:
 *     DocumentUploadResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *         document_id:
 *           type: string
 *           format: uuid
 *         message:
 *           type: string
 */

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
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

/**
 * @openapi
 * /api/driver/documents:
 *   post:
 *     tags: [Documents]
 *     summary: Upload a driver document
 *     description: Uploads a driver verification document (photo or PDF). File is validated by magic bytes before storage. Max file size is 8MB.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               document:
 *                 type: string
 *                 format: binary
 *                 description: Document file (photo or PDF, max 8MB)
 *     responses:
 *       201:
 *         description: Document uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DocumentUploadResponse'
 *       400:
 *         description: Invalid file or file too large
 *       413:
 *         description: File size exceeds limit
 */
// POST /api/driver/documents
router.post('/', authenticate, userLimiter, requirePolicy('document:upload'), upload.single('document'), uploadDriverDocument);

export default router;
