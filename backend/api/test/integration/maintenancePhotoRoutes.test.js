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

const { default: maintenanceRouter } = await import('../../src/routes/maintenancePhotoRoutes.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/maintenance', maintenanceRouter);
  return app;
}

const DRIVER_HEADERS = {
  'x-user-id': 'driver-uuid-123',
  'x-user-role': 'driver',
  'x-user-name': 'Test Driver',
};

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const EXECUTABLE_BYTES = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);

describe('Maintenance Photo Routes Integration Tests', () => {
  beforeEach(() => {
    process.env.BYPASS_AUTH = 'true';
    process.env.NODE_ENV = 'test';
    m.store.truck_maintenance_tickets = [
      {
        id: 'ticket-uuid-001',
        truck_id: 'truck-uuid-001',
        driver_id: 'driver-uuid-123',
        category: 'Engine',
        description: 'Test issue',
        status: 'open',
        photo_urls: [],
        created_at: new Date().toISOString(),
      },
    ];
    m.store.__storageObjects = [];
    m.calls.length = 0;
  });

  describe('POST /api/maintenance/:ticketId/photos', () => {
    it('returns 401 if x-user-id header is missing', async () => {
      const res = await request(buildApp())
        .post('/api/maintenance/ticket-uuid-001/photos')
        .field('photos', 'dummy')
        .attach('photos', JPEG_BYTES, { filename: 'photo.jpg', contentType: 'image/jpeg' });

      expect(res.status).toBe(401);
    });

    it('returns 400 if no file is attached', async () => {
      const res = await request(buildApp())
        .post('/api/maintenance/ticket-uuid-001/photos')
        .set(DRIVER_HEADERS)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('At least one photo file is required');
    });

    it('returns 404 if ticket does not exist', async () => {
      m.store.truck_maintenance_tickets = [];

      const res = await request(buildApp())
        .post('/api/maintenance/nonexistent-ticket/photos')
        .set(DRIVER_HEADERS)
        .attach('photos', JPEG_BYTES, { filename: 'photo.jpg', contentType: 'image/jpeg' });

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });

    it('returns 403 if ticket belongs to a different driver', async () => {
      m.store.truck_maintenance_tickets[0].driver_id = 'other-driver-uuid';

      const res = await request(buildApp())
        .post('/api/maintenance/ticket-uuid-001/photos')
        .set(DRIVER_HEADERS)
        .attach('photos', JPEG_BYTES, { filename: 'photo.jpg', contentType: 'image/jpeg' });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/permission/i);
    });

    it('accepts a real JPEG and stores it', async () => {
      const res = await request(buildApp())
        .post('/api/maintenance/ticket-uuid-001/photos')
        .set(DRIVER_HEADERS)
        .attach('photos', JPEG_BYTES, { filename: 'photo.jpg', contentType: 'image/jpeg' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.uploaded_count).toBe(1);
      expect(res.body.photo_urls).toHaveLength(1);

      const stored = m.store.__storageObjects.find(
        (o) => o.bucket === 'maintenance-photos'
      );
      expect(stored).toBeTruthy();
      expect(stored.path.startsWith('driver-uuid-123/ticket-uuid-001/')).toBe(true);
    });

    it('accepts a real PNG', async () => {
      const res = await request(buildApp())
        .post('/api/maintenance/ticket-uuid-001/photos')
        .set(DRIVER_HEADERS)
        .attach('photos', PNG_BYTES, { filename: 'photo.png', contentType: 'image/png' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.uploaded_count).toBe(1);
    });

    it('rejects an executable renamed to .jpg with 422', async () => {
      const res = await request(buildApp())
        .post('/api/maintenance/ticket-uuid-001/photos')
        .set(DRIVER_HEADERS)
        .attach('photos', EXECUTABLE_BYTES, { filename: 'photo.jpg', contentType: 'image/jpeg' });

      expect(res.status).toBe(422);
      expect(res.body.error).toMatch(/invalid|unsupported/i);
      expect(m.store.__storageObjects.length).toBe(0);
    });

    it('returns 500 if storage upload fails', async () => {
      m.programStorageError('Storage bucket unavailable');

      const res = await request(buildApp())
        .post('/api/maintenance/ticket-uuid-001/photos')
        .set(DRIVER_HEADERS)
        .attach('photos', JPEG_BYTES, { filename: 'photo.jpg', contentType: 'image/jpeg' });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to store photo');
    });

    it('supports uploading multiple photos at once', async () => {
      const res = await request(buildApp())
        .post('/api/maintenance/ticket-uuid-001/photos')
        .set(DRIVER_HEADERS)
        .attach('photos', JPEG_BYTES, { filename: 'photo1.jpg', contentType: 'image/jpeg' })
        .attach('photos', PNG_BYTES, { filename: 'photo2.png', contentType: 'image/png' });

      expect(res.status).toBe(200);
      expect(res.body.uploaded_count).toBe(2);
      expect(res.body.photo_urls).toHaveLength(2);
    });

    it('updates the ticket record with photo URLs', async () => {
      await request(buildApp())
        .post('/api/maintenance/ticket-uuid-001/photos')
        .set(DRIVER_HEADERS)
        .attach('photos', JPEG_BYTES, { filename: 'photo.jpg', contentType: 'image/jpeg' });

      const ticket = m.store.truck_maintenance_tickets.find(
        (t) => t.id === 'ticket-uuid-001'
      );
      expect(ticket.photo_urls.length).toBe(1);
    });
  });
});
