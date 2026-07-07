import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

const { createSupabaseMock } = await vi.importActual('../helpers/supabaseMock.js');
const m = createSupabaseMock();

vi.mock('../../src/config/db.js', () => ({
  supabase: m.supabase,
  firebaseAdmin: null,
  redisClient: null,
  mongoDb: null,
}));

const { default: documentRouter } = await import('../../src/routes/documentRoutes.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/driver/documents', documentRouter);
  return app;
}

const DRIVER_HEADERS = {
  'x-user-id': 'driver-uuid-123',
  'x-user-role': 'driver',
  'x-user-name': 'Test Driver',
};

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const EXECUTABLE_RENAMED_AS_JPG = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);

describe('Document Routes Integration Tests', () => {
  beforeEach(() => {
    process.env.BYPASS_AUTH = 'true';
    process.env.NODE_ENV = 'test';
    m.store.driver_documents = [];
    m.store.__storageObjects = [];
    m.calls.length = 0;
  });

  describe('POST /api/driver/documents', () => {
    it('returns 401 if x-user-id header is missing when BYPASS_AUTH is enabled', async () => {
      const res = await request(buildApp())
        .post('/api/driver/documents')
        .field('documentType', 'aadhaar_card')
        .attach('document', JPEG_BYTES, { filename: 'id.jpg', contentType: 'image/jpeg' });

      expect(res.status).toBe(401);
    });

    it('returns 400 if no file is attached', async () => {
      const res = await request(buildApp())
        .post('/api/driver/documents')
        .set(DRIVER_HEADERS)
        .field('documentType', 'aadhaar_card');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('A document file is required');
    });

    it('returns 400 for an unrecognized documentType', async () => {
      const res = await request(buildApp())
        .post('/api/driver/documents')
        .set(DRIVER_HEADERS)
        .field('documentType', 'passport')
        .attach('document', JPEG_BYTES, { filename: 'id.jpg', contentType: 'image/jpeg' });

      expect(res.status).toBe(400);
    });

    it('accepts a real JPEG declared as image/jpeg and stores it', async () => {
      const res = await request(buildApp())
        .post('/api/driver/documents')
        .set(DRIVER_HEADERS)
        .field('documentType', 'aadhaar_card')
        .attach('document', JPEG_BYTES, { filename: 'id.jpg', contentType: 'image/jpeg' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.document.document_type).toBe('aadhaar_card');
      expect(res.body.document.status).toBe('pending_review');

      const stored = m.store.driver_documents.find((d) => d.driver_id === 'driver-uuid-123');
      expect(stored).toBeTruthy();
      expect(stored.mime_type).toBe('image/jpeg');

      const uploadedObject = m.store.__storageObjects.find((o) => o.bucket === 'driver-documents');
      expect(uploadedObject).toBeTruthy();
      expect(uploadedObject.path.startsWith('driver-uuid-123/')).toBe(true);
    });

    it('rejects an executable renamed to .jpg with a 422 and does not store it', async () => {
      const res = await request(buildApp())
        .post('/api/driver/documents')
        .set(DRIVER_HEADERS)
        .field('documentType', 'aadhaar_card')
        .attach('document', EXECUTABLE_RENAMED_AS_JPG, { filename: 'id.jpg', contentType: 'image/jpeg' });

      expect(res.status).toBe(422);
      expect(res.body.error).toMatch(/Invalid document type/);
      expect(m.store.driver_documents.length).toBe(0);
      expect(m.store.__storageObjects.length).toBe(0);
    });

    it('rejects a file whose real content does not match its declared Content-Type', async () => {
      const res = await request(buildApp())
        .post('/api/driver/documents')
        .set(DRIVER_HEADERS)
        .field('documentType', 'aadhaar_card')
        .attach('document', JPEG_BYTES, { filename: 'id.png', contentType: 'image/png' });

      expect(res.status).toBe(422);
      expect(res.body.error).toMatch(/does not match declared type/);
    });

    it('returns 500 if storage upload fails and does not expose internal error details', async () => {
      m.programStorageError('Storage bucket unavailable');

      const res = await request(buildApp())
        .post('/api/driver/documents')
        .set(DRIVER_HEADERS)
        .field('documentType', 'aadhaar_card')
        .attach('document', JPEG_BYTES, { filename: 'id.jpg', contentType: 'image/jpeg' });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to store document');
    });
  });
});
