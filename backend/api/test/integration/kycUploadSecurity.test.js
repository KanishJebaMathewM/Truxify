import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

const { createSupabaseMock } = await vi.importActual('../helpers/supabaseMock.js');
const m = createSupabaseMock();

vi.mock('../../src/config/db.js', () => ({
  supabase: m.supabase,
  supabaseAdmin: null,
  firebaseAdmin: null,
  redisClient: null,
  mongoDb: null,
}));

vi.mock('../../src/lib/malwareScanner.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    scanDocument: vi.fn().mockResolvedValue({ clean: true, engine: 'mock' }),
  };
});

const { default: verificationRouter } = await import('../../src/routes/verificationRoutes.js');
const { scanDocument } = await import('../../src/lib/malwareScanner.js');
const { errorHandler } = await import('../../src/middleware/errorHandler.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/verify', verificationRouter);
  app.use(errorHandler);
  return app;
}

const DRIVER_HEADERS = {
  'x-user-id': 'kyc-driver-uuid-123',
  'x-user-role': 'driver',
  'x-user-name': 'Test Driver',
};

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const EXECUTABLE_RENAMED_AS_JPG = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
const KYC_MAX_FILE_SIZE = 10 * 1024 * 1024;

describe('KYC Upload Route Security Tests', () => {
  beforeEach(() => {
    process.env.BYPASS_AUTH = 'true';
    process.env.NODE_ENV = 'test';
    m.store.driver_details = [
      { driver_id: 'kyc-driver-uuid-123', kyc_status: 'Not Submitted' },
    ];
    m.calls.length = 0;
    scanDocument.mockResolvedValue({ clean: true, engine: 'mock' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns 413 for an oversized image', async () => {
    const oversized = Buffer.alloc(KYC_MAX_FILE_SIZE + 1024, 0xff);

    const res = await request(buildApp())
      .post('/api/verify/kyc/upload')
      .set(DRIVER_HEADERS)
      .attach('image', oversized, { filename: 'big.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/File upload error/);
  });

  it('rejects a disallowed MIME type (400, file is skipped by fileFilter)', async () => {
    const res = await request(buildApp())
      .post('/api/verify/kyc/upload')
      .set(DRIVER_HEADERS)
      .attach('image', Buffer.from('GIF89a-not-an-image'), { filename: 'doc.gif', contentType: 'image/gif' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('No image uploaded');
    expect(scanDocument).not.toHaveBeenCalled();
  });

  it('rejects an executable renamed to .jpg with 422 and never forwards to the ML endpoint', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await request(buildApp())
      .post('/api/verify/kyc/upload')
      .set(DRIVER_HEADERS)
      .attach('image', EXECUTABLE_RENAMED_AS_JPG, { filename: 'id.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/Invalid document type/);
    expect(fetchMock).not.toHaveBeenCalled();
    const row = m.store.driver_details.find((d) => d.driver_id === 'kyc-driver-uuid-123');
    expect(row.kyc_status).toBe('Not Submitted');
  });

  it('rejects a file whose real content does not match its declared Content-Type', async () => {
    const res = await request(buildApp())
      .post('/api/verify/kyc/upload')
      .set(DRIVER_HEADERS)
      .attach('image', JPEG_BYTES, { filename: 'id.png', contentType: 'image/png' });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/does not match declared type/);
  });

  it('rejects a valid-looking image when the malware scanner flags it (422)', async () => {
    const { MalwareScanError } = await import('../../src/lib/malwareScanner.js');
    scanDocument.mockRejectedValue(new MalwareScanError('Uploaded file is infected: TestVirus'));

    const res = await request(buildApp())
      .post('/api/verify/kyc/upload')
      .set(DRIVER_HEADERS)
      .attach('image', JPEG_BYTES, { filename: 'id.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/infected|TestVirus/i);
  });

  it('accepts a real JPEG and forwards it to the ML endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ verified: true, extracted_number: 'DL-12345678' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await request(buildApp())
      .post('/api/verify/kyc/upload')
      .set(DRIVER_HEADERS)
      .attach('image', JPEG_BYTES, { filename: 'id.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:8000/verify/kyc');

    const row = m.store.driver_details.find((d) => d.driver_id === 'kyc-driver-uuid-123');
    expect(row.kyc_status).toBe('Verified');
    expect(row.kyc_doc_number).toBe('DL-12345678');
  });
});
