import { describe, it, expect, vi, beforeEach } from 'vitest';

const supabaseMock = {
  from: vi.fn(),
  storage: {
    from: vi.fn(),
  },
};

let mockValidateDocumentBuffer = vi.fn();
let mockScanDocument = vi.fn();
let mockDocumentValidationError = class extends Error {};
let mockMalwareScanError = class extends Error {};

vi.mock('../../../src/config/db.js', () => ({
  supabaseAdmin: supabaseMock,
}));

vi.mock('../../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../src/lib/documentValidation.js', () => ({
  get validateDocumentBuffer() {
    return mockValidateDocumentBuffer;
  },
  get DocumentValidationError() {
    return mockDocumentValidationError;
  },
}));

vi.mock('../../../src/lib/malwareScanner.js', () => ({
  get scanDocument() {
    return mockScanDocument;
  },
  get MalwareScanError() {
    return mockMalwareScanError;
  },
}));

const { uploadDriverDocument } = await import(
  '../../../src/controllers/documentController.js'
);

function makeRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() };
}

function makeReq(overrides = {}) {
  return {
    user: { id: 'driver-1' },
    body: { documentType: 'aadhaar_card' },
    file: { buffer: Buffer.from('%PDF-1.4 fake'), size: 64, mimetype: 'application/pdf', originalname: 'aadhaar.pdf' },
    ...overrides,
  };
}

describe('uploadDriverDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateDocumentBuffer = vi.fn(() => 'application/pdf');
    mockScanDocument = vi.fn(async () => ({ clean: true }));
    mockDocumentValidationError = class extends Error {};
    mockMalwareScanError = class extends Error {};

    // Chainable query builder defaults
    const builder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'doc-1' }, error: null }),
      upload: vi.fn().mockResolvedValue({ error: null }),
    };
    supabaseMock.from.mockReturnValue(builder);
    supabaseMock.storage.from.mockReturnValue(builder);
  });

  it('returns 401 when the user is not authenticated', async () => {
    const req = makeReq({ user: null });
    const res = makeRes();

    await uploadDriverDocument(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'User not authenticated' });
  });

  it('returns 400 when no file is attached', async () => {
    const req = makeReq({ file: undefined });
    const res = makeRes();

    await uploadDriverDocument(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'A document file is required' });
  });

  it('returns 413 when the file exceeds the size limit', async () => {
    const req = makeReq({ file: { buffer: Buffer.alloc(11 * 1024 * 1024), size: 11 * 1024 * 1024, mimetype: 'application/pdf', originalname: 'big.pdf' } });
    const res = makeRes();

    await uploadDriverDocument(req, res);

    expect(res.status).toHaveBeenCalledWith(413);
  });

  it('returns 400 when the document type is missing or invalid', async () => {
    const req = makeReq({ body: { documentType: 'fake_type' } });
    const res = makeRes();

    await uploadDriverDocument(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining('documentType must be one of') });
  });

  it('returns 422 when the magic-byte validation fails', async () => {
    mockValidateDocumentBuffer = vi.fn(() => {
      const err = new mockDocumentValidationError('Invalid document type');
      throw err;
    });
    const req = makeReq();
    const res = makeRes();

    await uploadDriverDocument(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
  });

  it('returns 504 when the malware scan times out', async () => {
    mockScanDocument = vi.fn(() => {
      const err = new Error('Malware scanning timed out');
      err.name = 'TimeoutError';
      return Promise.reject(err);
    });
    const req = makeReq();
    const res = makeRes();

    await uploadDriverDocument(req, res);

    expect(res.status).toHaveBeenCalledWith(504);
  });

  it('returns 422 when the malware scan rejects the file', async () => {
    mockScanDocument = vi.fn(() => {
      const err = new mockMalwareScanError('Malware detected');
      return Promise.reject(err);
    });
    const req = makeReq();
    const res = makeRes();

    await uploadDriverDocument(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
  });

  it('returns 201 and uploads storage + inserts a metadata row for a new document', async () => {
    const req = makeReq();
    const res = makeRes();

    await uploadDriverDocument(req, res);

    expect(supabaseMock.from).toHaveBeenCalledWith('driver_documents');
    expect(supabaseMock.storage.from).toHaveBeenCalledWith('driver-documents');
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('returns 200 and updates the metadata row when an existing document is superseded', async () => {
    supabaseMock.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: 'doc-1', storage_path: 'driver-1/aadhaar_card-old.pdf' },
        error: null,
      }),
      update: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'doc-1' }, error: null }),
      upload: vi.fn().mockResolvedValue({ error: null }),
    });
    supabaseMock.storage.from.mockReturnValue({
      upload: vi.fn().mockResolvedValue({ error: null }),
      remove: vi.fn().mockResolvedValue({ error: null }),
    });
    const req = makeReq();
    const res = makeRes();

    await uploadDriverDocument(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });
});
