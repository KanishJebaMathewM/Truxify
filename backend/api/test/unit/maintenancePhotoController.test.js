import { describe, it, expect, vi, beforeEach } from 'vitest';

const { dbMock, docMock, scanMock } = vi.hoisted(() => ({
  dbMock: { supabase: { from: vi.fn(), rpc: vi.fn() } },
  docMock: { validateDocumentBuffer: vi.fn(), DocumentValidationError: class extends Error {} },
  scanMock: { scanDocument: vi.fn(), MalwareScanError: class extends Error {} },
}));

vi.mock('../../src/config/db.js', () => ({
  get supabase() { return dbMock.supabase; },
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/lib/documentValidation.js', () => docMock);
vi.mock('../../src/lib/malwareScanner.js', () => scanMock);

import { uploadMaintenancePhotos } from '../../src/controllers/maintenancePhotoController.js';

function makeReqRes(overrides = {}) {
  const req = { user: { id: 'driver-1' }, params: { ticketId: 't1' }, files: [], ...overrides };
  const res = { status: vi.fn(() => res), json: vi.fn(() => res) };
  return { req, res };
}

describe('maintenancePhotoController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    docMock.validateDocumentBuffer.mockReturnValue('image/jpeg');
    scanMock.scanDocument.mockResolvedValue({ clean: true });
    dbMock.supabase.storage = {
      from: vi.fn(() => ({
        upload: vi.fn().mockResolvedValue({ error: null }),
        createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: 'https://url/1' }, error: null }),
        remove: vi.fn().mockResolvedValue({ error: null }),
      })),
    };
  });

  it('returns 401 without a user', async () => {
    const { req, res } = makeReqRes({ user: null });
    await uploadMaintenancePhotos(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 400 when ticketId is missing', async () => {
    const { req, res } = makeReqRes({ params: {} });
    await uploadMaintenancePhotos(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when no files are uploaded', async () => {
    const { req, res } = makeReqRes();
    await uploadMaintenancePhotos(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when too many files are uploaded', async () => {
    const { req, res } = makeReqRes({ files: [{ buffer: Buffer.from('a') }, { buffer: Buffer.from('b') }, { buffer: Buffer.from('c') }, { buffer: Buffer.from('d') }] });
    await uploadMaintenancePhotos(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 404 when the ticket is not found', async () => {
    dbMock.supabase.from.mockReturnValue({
      select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) })) })),
    });
    const { req, res } = makeReqRes({ files: [{ buffer: Buffer.from('a'), mimetype: 'image/jpeg' }] });
    await uploadMaintenancePhotos(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 403 when the ticket belongs to another driver', async () => {
    dbMock.supabase.from.mockReturnValue({
      select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: 't1', driver_id: 'other', photo_urls: [] }, error: null }) })) })),
    });
    const { req, res } = makeReqRes({ files: [{ buffer: Buffer.from('a'), mimetype: 'image/jpeg' }] });
    await uploadMaintenancePhotos(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('uploads photos and returns URLs on success', async () => {
    dbMock.supabase.from.mockReturnValue({
      select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: 't1', driver_id: 'driver-1', photo_urls: [] }, error: null }) })) })),
    });
    dbMock.supabase.rpc.mockResolvedValue({ error: null });
    const { req, res } = makeReqRes({ files: [{ buffer: Buffer.from('a'), mimetype: 'image/jpeg' }] });
    await uploadMaintenancePhotos(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, uploaded_count: 1 }));
  });
});
