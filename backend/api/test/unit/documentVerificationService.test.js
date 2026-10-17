import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../src/config/db.js', () => ({
  get supabaseAdmin() { return null; },
}));
vi.mock('../../src/lib/ocrProcessor.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, extractText: vi.fn() };
});

const { extractText } = await import('../../src/lib/ocrProcessor.js');
const { processDocumentUpload } = await import('../../src/services/documentVerificationService.js');

const goodFile = { mimetype: 'image/jpeg', size: 500_000, buffer: Buffer.from([0xff, 0xd8, 0xff]) };

describe('documentVerificationService.processDocumentUpload', () => {
  it('rejects invalid files before any OCR work', async () => {
    const res = await processDocumentUpload({
      driverId: 'd1', docType: 'DL',
      file: { mimetype: 'application/x-msdownload', size: 5000, buffer: Buffer.alloc(2000) },
      storagePath: 'x',
    });
    expect(res.success).toBe(false);
    expect(res.status).toBe('rejected');
    expect(extractText).not.toHaveBeenCalled();
  });

  it('OCR failure → status error (not rejected)', async () => {
    extractText.mockRejectedValueOnce(new Error('tesseract crashed'));
    const res = await processDocumentUpload({ driverId: 'd1', docType: 'DL', file: goodFile, storagePath: 'x' });
    expect(res.status).toBe('error');
    expect(res.success).toBe(false);
  });

  it('low-confidence OCR → rejected with guidance', async () => {
    extractText.mockResolvedValueOnce({ text: 'blur', words: [{ confidence: 20 }, { confidence: 30 }] });
    const res = await processDocumentUpload({ driverId: 'd1', docType: 'DL', file: goodFile, storagePath: 'x' });
    expect(res.status).toBe('rejected');
    expect(res.error).toMatch(/confidence too low/);
    expect(res.confidence).toBe(25);
  });

  it('a fully valid document verifies (number normalized)', async () => {
    extractText.mockResolvedValueOnce({
      text: 'DRIVING LICENSE\nNAME: RAJ KUMAR\nDOB: 15/06/1988\n01/01/2020\n31/12/2035\nMH0120110000001',
      words: Array.from({ length: 10 }, () => ({ confidence: 95 })),
    });
    const res = await processDocumentUpload({ driverId: 'd1', docType: 'DL', file: goodFile, storagePath: 'x' });
    expect(res.status).toBe('verified');
    expect(res.success).toBe(true);
    expect(res.extractedData.document_number).toBe('MH0120110000001');
  });

  it('an expired document is rejected with the expiry reason', async () => {
    extractText.mockResolvedValueOnce({
      text: 'DRIVING LICENSE\nNAME: OLD DRIVER\nDOB: 01/01/1970\n01/01/2010\n01/01/2020\nMH0120110000001',
      words: Array.from({ length: 10 }, () => ({ confidence: 95 })),
    });
    const res = await processDocumentUpload({ driverId: 'd1', docType: 'DL', file: goodFile, storagePath: 'x' });
    expect(res.status).toBe('rejected');
    expect(res.reason).toMatch(/expired/);
  });

  it('missing required fields → pending_review with the missing-field list', async () => {
    extractText.mockResolvedValueOnce({
      text: 'DRIVING LICENSE\nMH0120110000001\n31/12/2035',
      words: Array.from({ length: 10 }, () => ({ confidence: 95 })),
    });
    const res = await processDocumentUpload({ driverId: 'd1', docType: 'DL', file: goodFile, storagePath: 'x' });
    expect(res.status).toBe('pending_review');
    expect(res.reason).toMatch(/Missing fields/);
  });
});
