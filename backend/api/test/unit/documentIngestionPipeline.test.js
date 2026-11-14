import { describe, it, expect, vi, beforeEach } from 'vitest';

const scanDocument = vi.hoisted(() => vi.fn());
const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));

vi.mock('../../src/lib/malwareScanner.js', () => ({ scanDocument }));
vi.mock('../../src/middleware/logger.js', () => ({ default: logger }));

import { DocumentIngestionPipeline } from '../../src/services/verification/documentIngestionPipeline.js';

const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(32)]);

describe('DocumentIngestionPipeline scanning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the exported scanDocument contract and accepts a clean file', async () => {
    scanDocument.mockResolvedValue({ clean: true, engine: 'clamav' });

    const result = await new DocumentIngestionPipeline().processDocument(PDF, 'application/pdf');

    expect(scanDocument).toHaveBeenCalledWith(PDF);
    expect(result.isValid).toBe(true);
    expect(result.detectedMimeType).toBe('application/pdf');
    expect(result.sha256Hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects a file when the scanner reports a threat', async () => {
    scanDocument.mockResolvedValue({ clean: false, engine: 'clamav', reason: 'Eicar-Test-Signature' });

    await expect(
      new DocumentIngestionPipeline().processDocument(PDF, 'application/pdf')
    ).rejects.toThrow('Eicar-Test-Signature');
    expect(logger.warn).toHaveBeenCalledWith(
      { threat: 'Eicar-Test-Signature' },
      '[DocumentIngestionPipeline] Malware detected in upload'
    );
  });
});
