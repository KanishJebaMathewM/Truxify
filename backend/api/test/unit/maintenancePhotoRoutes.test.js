import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => { req.user = req.user || { id: 'driver-1' }; next(); },
  requireRole: () => (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  userLimiter: (_req, _res, next) => next(),
  deviceLimiter: (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/requirePolicy.js', () => ({
  requirePolicy: () => (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/validate.js', () => ({
  validateBody: () => (_req, _res, next) => next(),
  validateParams: () => (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// Multer must NOT be mocked — supertest's .attach() sends real multipart data.
// Instead, use a real but in-memory multer instance for the route.
import multer from 'multer';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

const { supabase, supabaseAdmin, createUserClient } = vi.hoisted(() => ({
  supabase: {
    from: vi.fn(),
    storage: vi.fn(),
  },
  supabaseAdmin: {
    from: vi.fn(),
    storage: vi.fn(),
    rpc: vi.fn(),
  },
  createUserClient: vi.fn(),
}));

vi.mock('../../src/config/db.js', () => ({
  supabase,
  supabaseAdmin,
  createUserClient,
}));

vi.mock('../../src/lib/documentValidation.js', () => ({
  ALLOWED_DOCUMENT_MIME_TYPES: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  validateDocumentBuffer: vi.fn().mockReturnValue('image/jpeg'),
}));

vi.mock('../../src/lib/malwareScanner.js', () => ({
  scanDocument: vi.fn().mockResolvedValue({ clean: true }),
  MalwareScanError: class MalwareScanError extends Error {
    constructor(message) { super(message); this.name = 'MalwareScanError'; }
  },
}));

const uploadMaintenancePhotos = vi.hoisted(() => vi.fn((req, res) => {
  const uploadedFiles = req.files;
  if (!uploadedFiles || uploadedFiles.length === 0) {
    return res.status(400).json({ error: 'At least one photo file is required' });
  }
  return res.status(200).json({
    success: true,
    photo_urls: uploadedFiles.map((_, i) => `https://storage.example.com/photo${i + 1}.jpg`),
    uploaded_count: uploadedFiles.length,
  });
}));

vi.mock('../../src/controllers/maintenancePhotoController.js', () => ({
  uploadMaintenancePhotos,
}));

import maintenancePhotoRoutes from '../../src/routes/maintenancePhotoRoutes.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/maintenance', maintenancePhotoRoutes);
  return app;
}

describe('maintenancePhotoRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uploadMaintenancePhotos.mockImplementation((req, res) => {
      const uploadedFiles = req.files;
      if (!uploadedFiles || uploadedFiles.length === 0) {
        return res.status(400).json({ error: 'At least one photo file is required' });
      }
      return res.status(200).json({
        success: true,
        photo_urls: uploadedFiles.map((_, i) => `https://storage.example.com/photo${i + 1}.jpg`),
        uploaded_count: uploadedFiles.length,
      });
    });
  });

  const VALID_TICKET_ID = 'ticket-123';
  const MOCK_TOKEN = { sub: 'driver-1', role: 'driver' };

  describe('POST /maintenance/:ticketId/photos', () => {
    it('mp1: returns 200 with single photo upload', async () => {
      const mockFile = {
        fieldname: 'photos',
        originalname: 'photo1.jpg',
        encoding: '7bit',
        mimetype: 'image/jpeg',
        buffer: Buffer.from('fake-image-data'),
        size: 1024,
      };

      const res = await request(makeApp())
        .post(`/maintenance/${VALID_TICKET_ID}/photos`)
        .attach('photos', Buffer.from('fake-image-data'), {
          filename: 'photo1.jpg',
          contentType: 'image/jpeg',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.uploaded_count).toBe(1);
    });

    it('mp2: returns 200 with multiple photo uploads', async () => {
      const res = await request(makeApp())
        .post(`/maintenance/${VALID_TICKET_ID}/photos`)
        .attach('photos', Buffer.from('fake-image-1'), {
          filename: 'photo1.jpg',
          contentType: 'image/jpeg',
        })
        .attach('photos', Buffer.from('fake-image-2'), {
          filename: 'photo2.jpg',
          contentType: 'image/jpeg',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.uploaded_count).toBe(2);
      expect(res.body.photo_urls).toHaveLength(2);
    });

    it('mp3: returns 200 with PNG image upload', async () => {
      const res = await request(makeApp())
        .post(`/maintenance/${VALID_TICKET_ID}/photos`)
        .attach('photos', Buffer.from('fake-png-data'), {
          filename: 'photo1.png',
          contentType: 'image/png',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('mp4: returns 400 when no files are uploaded', async () => {
      const res = await request(makeApp())
        .post(`/maintenance/${VALID_TICKET_ID}/photos`);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('At least one photo file is required');
    });

    it('mp5: handles controller returning photo_urls array', async () => {
      uploadMaintenancePhotos.mockImplementation((req, res) => {
        return res.status(200).json({
          success: true,
          photo_urls: [
            'https://storage.example.com/driver-1/ticket-123/photo1.jpg',
            'https://storage.example.com/driver-1/ticket-123/photo2.jpg',
          ],
          uploaded_count: 2,
        });
      });

      const res = await request(makeApp())
        .post(`/maintenance/${VALID_TICKET_ID}/photos`)
        .attach('photos', Buffer.from('fake-image-1'), { filename: 'photo1.jpg', contentType: 'image/jpeg' })
        .attach('photos', Buffer.from('fake-image-2'), { filename: 'photo2.jpg', contentType: 'image/jpeg' });

      expect(res.status).toBe(200);
      expect(res.body.photo_urls).toHaveLength(2);
      expect(res.body.photo_urls[0]).toContain('storage.example.com');
    });

    it('mp6: includes ticketId in response context', async () => {
      uploadMaintenancePhotos.mockImplementation((req, res) => {
        expect(req.params.ticketId).toBe(VALID_TICKET_ID);
        return res.status(200).json({
          success: true,
          photo_urls: ['https://storage.example.com/photo1.jpg'],
          uploaded_count: 1,
        });
      });

      const res = await request(makeApp())
        .post(`/maintenance/${VALID_TICKET_ID}/photos`)
        .attach('photos', Buffer.from('fake-image-data'), {
          filename: 'photo1.jpg',
          contentType: 'image/jpeg',
        });

      expect(res.status).toBe(200);
    });

    it('mp7: includes user context from auth middleware', async () => {
      uploadMaintenancePhotos.mockImplementation((req, res) => {
        expect(req.user).toBeDefined();
        expect(req.user.id).toBe('driver-1');
        return res.status(200).json({
          success: true,
          photo_urls: ['https://storage.example.com/photo1.jpg'],
          uploaded_count: 1,
        });
      });

      const res = await request(makeApp())
        .post(`/maintenance/${VALID_TICKET_ID}/photos`)
        .attach('photos', Buffer.from('fake-image-data'), {
          filename: 'photo1.jpg',
          contentType: 'image/jpeg',
        });

      expect(res.status).toBe(200);
    });

    it('mp8: handles route with different ticket ID format', async () => {
      const customTicketId = 'custom-ticket-456';

      uploadMaintenancePhotos.mockImplementation((req, res) => {
        expect(req.params.ticketId).toBe(customTicketId);
        return res.status(200).json({
          success: true,
          photo_urls: ['https://storage.example.com/photo1.jpg'],
          uploaded_count: 1,
        });
      });

      const res = await request(makeApp())
        .post(`/maintenance/${customTicketId}/photos`)
        .attach('photos', Buffer.from('fake-image-data'), {
          filename: 'photo1.jpg',
          contentType: 'image/jpeg',
        });

      expect(res.status).toBe(200);
    });
  });
});
