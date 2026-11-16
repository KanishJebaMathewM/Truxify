import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('documentController', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  function mockLogger() {
    return {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
      child: vi.fn(() => ({
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
      })),
    };
  }

  function mockDb(supabaseAdmin) {
    vi.doMock('../../src/config/db.js', () => ({
      supabaseAdmin,
    }));
    vi.doMock('../../src/middleware/logger.js', () => ({
      default: mockLogger(),
    }));
  }

  function makeRes() {
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    return res;
  }

  it('exports uploadDriverDocument', async () => {
    mockDb({});
    const mod = await import('../../src/controllers/documentController.js');
    expect(typeof mod.uploadDriverDocument).toBe('function');
  });

  it('returns 401 without a user', async () => {
    mockDb({});
    const { uploadDriverDocument } = await import('../../src/controllers/documentController.js');
    const res = makeRes();
    await uploadDriverDocument({ user: null, file: null, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'User not authenticated' });
  });

  it('returns 503 without the service client', async () => {
    mockDb(null);
    const { uploadDriverDocument } = await import('../../src/controllers/documentController.js');
    const res = makeRes();
    await uploadDriverDocument({ user: { id: 'driver-1' }, file: null, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('returns 400 without a file', async () => {
    mockDb({});
    const { uploadDriverDocument } = await import('../../src/controllers/documentController.js');
    const res = makeRes();
    await uploadDriverDocument(
      { user: { id: 'driver-1' }, file: null, body: { documentType: 'pan_card' } },
      res
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'A document file is required' });
  });

  it('returns 413 for an oversized file', async () => {
    mockDb({});
    const { uploadDriverDocument } = await import('../../src/controllers/documentController.js');
    const res = makeRes();
    await uploadDriverDocument(
      {
        user: { id: 'driver-1' },
        file: { size: 11 * 1024 * 1024, buffer: Buffer.alloc(10), mimetype: 'image/png' },
        body: { documentType: 'pan_card' },
      },
      res
    );
    expect(res.status).toHaveBeenCalledWith(413);
  });

  it('returns 400 for an unknown document type', async () => {
    mockDb({});
    const { uploadDriverDocument } = await import('../../src/controllers/documentController.js');
    const res = makeRes();
    await uploadDriverDocument(
      {
        user: { id: 'driver-1' },
        file: { size: 10, buffer: Buffer.alloc(10), mimetype: 'image/png' },
        body: { documentType: 'passport' },
      },
      res
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
