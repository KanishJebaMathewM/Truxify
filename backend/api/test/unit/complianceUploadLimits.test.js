import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
  processDocumentUpload: vi.fn(),
  adminVerifyDocument: vi.fn(),
  getDriverDocuments: vi.fn(),
  checkDriverCompliance: vi.fn(),
}));

vi.mock('../../src/config/db.js', () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({ upload: mocks.upload }),
    },
  },
}));

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 'driver-1', role: 'driver' };
    next();
  },
  requireRole: () => (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/services/documentVerificationService.js', () => ({
  processDocumentUpload: mocks.processDocumentUpload,
  adminVerifyDocument: mocks.adminVerifyDocument,
  getDriverDocuments: mocks.getDriverDocuments,
}));

vi.mock('../../src/lib/expiryTracker.js', () => ({
  checkDriverCompliance: mocks.checkDriverCompliance,
}));

const {
  default: complianceRouter,
  MAX_COMPLIANCE_FILE_BYTES,
} = await import('../../src/routes/complianceRoutes.js');

function makeApp() {
  const app = express();
  app.use('/api/compliance', complianceRouter);
  return app;
}

function uploadRequest(app, { contentType = 'image/png', filename = 'license.exe', buffer = Buffer.alloc(2048, 1), docType = 'DL' } = {}) {
  return request(app)
    .post('/api/compliance/documents/upload')
    .field('docType', docType)
    .attach('document', buffer, { filename, contentType });
}

describe('compliance document upload limits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.upload.mockResolvedValue({ error: null });
    mocks.processDocumentUpload.mockResolvedValue({ success: true, status: 'verified' });
  });

  it('uses the validated MIME type for the storage extension', async () => {
    const app = makeApp();
    const res = await uploadRequest(app, { filename: 'license.exe', contentType: 'image/png' });

    expect(res.status).toBe(200);
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    const [storagePath, , options] = mocks.upload.mock.calls[0];
    expect(storagePath).toMatch(/^compliance\/driver-1\/DL_\d+\.png$/);
    expect(options.contentType).toBe('image/png');
    expect(mocks.processDocumentUpload).toHaveBeenCalledWith(expect.objectContaining({
      driverId: 'driver-1',
      docType: 'DL',
      storagePath,
    }));
  });

  it('rejects unsupported MIME types before storage', async () => {
    const app = makeApp();
    const res = await uploadRequest(app, { contentType: 'text/plain', filename: 'license.txt' });

    expect(res.status).toBe(415);
    expect(res.body.error).toMatch(/Unsupported document file type/);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.processDocumentUpload).not.toHaveBeenCalled();
  });

  it('rejects files over 10MB with 413', async () => {
    const app = makeApp();
    const res = await uploadRequest(app, {
      buffer: Buffer.alloc(MAX_COMPLIANCE_FILE_BYTES + 1, 1),
    });

    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/10MB limit/);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('rejects an upload without a file', async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/api/compliance/documents/upload')
      .field('docType', 'DL');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No document file provided/);
  });

  it('rejects an unknown document type before storage', async () => {
    const app = makeApp();
    const res = await uploadRequest(app, { docType: 'NOT_A_DOCUMENT' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid document type/);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});
