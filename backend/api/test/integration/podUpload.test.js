/**
 * Integration tests for the Proof of Delivery (PoD) upload endpoint.
 *
 * Run with: npm test -- test/integration/podUpload.test.js
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

// Hoisted mock — same pattern as orders.test.js
const { createSupabaseMock } = await vi.importActual('../helpers/supabaseMock.js');
const m = createSupabaseMock();

vi.mock('../../src/config/db.js', () => ({
  supabase: m.supabase,
  firebaseAdmin: null,
  get redisClient() { return null; },
  mongoDb: null,
}));

vi.mock('../../src/sockets/tracker.js', () => ({
  initWebSocketServer: () => ({}),
}));

vi.mock('../../src/services/osrm.js', () => ({
  getRouteEstimate: vi.fn(),
}));

vi.mock('../../src/services/reputation.js', () => ({
  reputationContract: {},
  awardReputationPoints: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/services/escrow.js', async () => {
  const actual = await vi.importActual('../../src/services/escrow.js');
  return {
    ...actual,
    escrowRelease: vi.fn(),
    submitEscrowRefund: vi.fn(),
    confirmEscrowRefund: vi.fn(),
  };
});

vi.mock('../../src/services/ml.js', () => ({
  predictDemand: vi.fn(),
}));

vi.mock('../../src/services/routingService.js', () => ({
  getRouteEstimate: vi.fn(),
}));

vi.mock('../../src/services/notificationService.js', async () => {
  const actual = await vi.importActual('../../src/services/notificationService.js');
  return {
    ...actual,
    expireDeliveryOtps: vi.fn(),
  };
});

const { default: orderRouter } = await import('../../src/routes/orderRoutes.js');
import express from 'express';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/orders', orderRouter);
  return app;
}

const DRIVER_HEADERS = {
  'x-user-id': '00000000-0000-0000-0000-000000000def',
  'x-user-role': 'driver',
  'x-user-name': 'Test Driver',
};

const OTHER_DRIVER_HEADERS = {
  'x-user-id': '00000000-0000-0000-0000-000000000eee',
  'x-user-role': 'driver',
  'x-user-name': 'Other Driver',
};

const CUSTOMER_HEADERS = {
  'x-user-id': '00000000-0000-0000-0000-000000000abc',
  'x-user-role': 'customer',
  'x-user-name': 'Test Customer',
};

const ORDER_ID = '11111111-0000-4000-8000-000000000001';

describe('POST /api/orders/:id/pod — Proof of Delivery upload', () => {
  beforeEach(() => {
    m.store.orders = [];
    m.store.order_timeline = [];
    m.calls.length = 0;
  });

  function seedOrder(overrides = {}) {
    m.store.orders.push({
      id: ORDER_ID,
      customer_id: CUSTOMER_HEADERS['x-user-id'],
      driver_id: DRIVER_HEADERS['x-user-id'],
      order_display_id: 'OD-POD-001',
      status: 'in_transit',
      pod_signature_url: null,
      pod_photo_url: null,
      pod_signature_hash: null,
      pod_photo_hash: null,
      ...overrides,
    });
  }

  // Minimal valid JPEG: SOI marker + APP0 header
  const validJpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  // Minimal valid PNG: 8-byte signature + IHDR chunk
  const validPngBuffer = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  ]);

  it('uploads photo and signature successfully', async () => {
    seedOrder();
    const app = buildApp();

    const res = await request(app)
      .post(`/api/orders/${ORDER_ID}/pod`)
      .set(DRIVER_HEADERS)
      .field('content-type', 'multipart/form-data')
      .attach('signature', validPngBuffer, { filename: 'signature.png', contentType: 'image/png' })
      .attach('photo', validJpegBuffer, { filename: 'photo.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Proof of Delivery uploaded successfully');
    expect(res.body.photoUrl).toBeDefined();
    expect(res.body.signatureUrl).toBeDefined();
    expect(res.body.photoHash).toBeDefined();
    expect(res.body.signatureHash).toBeDefined();
    expect(res.body.uploadTimestamp).toBeDefined();

    // Verify hashes are SHA-256 hex strings (64 chars)
    expect(res.body.photoHash).toMatch(/^[a-f0-9]{64}$/);
    expect(res.body.signatureHash).toMatch(/^[a-f0-9]{64}$/);

    // Verify storage upload was called
    const storageCalls = m.calls.filter(c => c.storageUpload);
    expect(storageCalls.length).toBe(2);
    expect(storageCalls.every(c => c.storageUpload.bucket === 'driver-documents')).toBe(true);
  });

  it('uploads only photo when signature is missing', async () => {
    seedOrder();
    const app = buildApp();

    const res = await request(app)
      .post(`/api/orders/${ORDER_ID}/pod`)
      .set(DRIVER_HEADERS)
      .field('content-type', 'multipart/form-data')
      .attach('photo', validJpegBuffer, { filename: 'photo.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(res.body.photoUrl).toBeDefined();
    expect(res.body.photoHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('uploads only signature when photo is missing', async () => {
    seedOrder();
    const app = buildApp();

    const res = await request(app)
      .post(`/api/orders/${ORDER_ID}/pod`)
      .set(DRIVER_HEADERS)
      .field('content-type', 'multipart/form-data')
      .attach('signature', validPngBuffer, { filename: 'sig.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    expect(res.body.signatureUrl).toBeDefined();
    expect(res.body.signatureHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns 404 when order does not exist', async () => {
    const app = buildApp();

    const res = await request(app)
      .post('/api/orders/nonexistent-order/pod')
      .set(DRIVER_HEADERS)
      .field('content-type', 'multipart/form-data')
      .attach('photo', validJpegBuffer, { filename: 'photo.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Order not found');
  });

  it('returns 403 when driver does not own the order', async () => {
    seedOrder({ driver_id: DRIVER_HEADERS['x-user-id'] });
    const app = buildApp();

    const res = await request(app)
      .post(`/api/orders/${ORDER_ID}/pod`)
      .set(OTHER_DRIVER_HEADERS)
      .field('content-type', 'multipart/form-data')
      .attach('photo', validJpegBuffer, { filename: 'photo.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Access Denied');
  });

  it('returns 403 when customer tries to upload PoD', async () => {
    seedOrder();
    const app = buildApp();

    const res = await request(app)
      .post(`/api/orders/${ORDER_ID}/pod`)
      .set(CUSTOMER_HEADERS)
      .field('content-type', 'multipart/form-data')
      .attach('photo', validJpegBuffer, { filename: 'photo.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(403);
  });

  it('rejects invalid file type (PDF) by silently excluding it', async () => {
    seedOrder();
    const app = buildApp();
    const pdfBuffer = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

    const res = await request(app)
      .post(`/api/orders/${ORDER_ID}/pod`)
      .set(DRIVER_HEADERS)
      .field('content-type', 'multipart/form-data')
      .attach('photo', pdfBuffer, { filename: 'doc.pdf', contentType: 'application/pdf' });

    // Multer fileFilter rejects invalid types — the file is silently excluded.
    // The endpoint processes with no valid photo files and returns success.
    expect(res.status).toBe(200);
    const updatedOrder = m.store.orders.find(o => o.id === ORDER_ID);
    // PDF was rejected, so photo should NOT have been uploaded
    expect(updatedOrder.pod_photo_url).toBeNull();
  });

  it('rejects file with mismatched content type (declared PNG, actual PDF)', async () => {
    seedOrder();
    const app = buildApp();
    const pdfBuffer = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

    const res = await request(app)
      .post(`/api/orders/${ORDER_ID}/pod`)
      .set(DRIVER_HEADERS)
      .field('content-type', 'multipart/form-data')
      .attach('photo', pdfBuffer, { filename: 'fake.png', contentType: 'image/png' });

    // multer allows it (declared type matches filter), but validateDocumentBuffer
    // detects magic bytes mismatch and returns 400.
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid photo file');
  });

  it('returns 500 when storage upload fails', async () => {
    seedOrder();
    m.programStorageError('Storage quota exceeded');
    const app = buildApp();

    const res = await request(app)
      .post(`/api/orders/${ORDER_ID}/pod`)
      .set(DRIVER_HEADERS)
      .field('content-type', 'multipart/form-data')
      .attach('photo', validJpegBuffer, { filename: 'photo.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(500);
    expect(res.body.error).toContain('storage');
  });

  it('returns structured response with all required fields', async () => {
    seedOrder();
    const app = buildApp();

    const res = await request(app)
      .post(`/api/orders/${ORDER_ID}/pod`)
      .set(DRIVER_HEADERS)
      .field('content-type', 'multipart/form-data')
      .attach('photo', validJpegBuffer, { filename: 'photo.jpg', contentType: 'image/jpeg' })
      .attach('signature', validPngBuffer, { filename: 'sig.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(
      expect.arrayContaining([
        'message',
        'photoUrl',
        'signatureUrl',
        'photoHash',
        'signatureHash',
        'uploadTimestamp',
      ])
    );
  });

  it('generates SHA-256 hashes for uploaded files', async () => {
    seedOrder();
    const app = buildApp();

    const res = await request(app)
      .post(`/api/orders/${ORDER_ID}/pod`)
      .set(DRIVER_HEADERS)
      .field('content-type', 'multipart/form-data')
      .attach('photo', validJpegBuffer, { filename: 'photo.jpg', contentType: 'image/jpeg' });

    expect(res.body.photoHash).toBeDefined();
    expect(res.body.photoHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('updates order record with pod URLs and hashes', async () => {
    seedOrder();
    const app = buildApp();

    await request(app)
      .post(`/api/orders/${ORDER_ID}/pod`)
      .set(DRIVER_HEADERS)
      .field('content-type', 'multipart/form-data')
      .attach('photo', validJpegBuffer, { filename: 'photo.jpg', contentType: 'image/jpeg' })
      .attach('signature', validPngBuffer, { filename: 'sig.png', contentType: 'image/png' });

    const updatedOrder = m.store.orders.find(o => o.id === ORDER_ID);
    expect(updatedOrder.pod_photo_url).toBeDefined();
    expect(updatedOrder.pod_signature_url).toBeDefined();
    expect(updatedOrder.pod_photo_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(updatedOrder.pod_signature_hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
