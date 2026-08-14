import { describe, it, expect } from 'vitest';
import { sanitizeUploadFilename, checkContentLength } from '../../../src/lib/uploadFilename.js';

describe('sanitizeUploadFilename', () => {
  describe('basic sanitisation', () => {
    it('returns the fallback for non-string input', () => {
      expect(sanitizeUploadFilename(null)).toBe('upload');
      expect(sanitizeUploadFilename(undefined)).toBe('upload');
      expect(sanitizeUploadFilename(123)).toBe('upload');
      expect(sanitizeUploadFilename({})).toBe('upload');
    });

    it('returns the fallback for empty string', () => {
      expect(sanitizeUploadFilename('')).toBe('upload');
      expect(sanitizeUploadFilename('', 'custom')).toBe('custom');
    });

    it('strips directory separators from filenames', () => {
      expect(sanitizeUploadFilename('path/to/file.pdf')).toBe('file.pdf');
      expect(sanitizeUploadFilename('C:\\Users\\file.pdf')).toBe('file.pdf');
      expect(sanitizeUploadFilename('mixed\\path/to\\file.pdf')).toBe('file.pdf');
    });

    it('strips path traversal sequences and directory components', () => {
      // stripDirectories takes the last segment only
      expect(sanitizeUploadFilename('../etc/passwd')).toBe('passwd');
      expect(sanitizeUploadFilename('..\\windows\\system32')).toBe('system32');
    });

    it('strips control characters', () => {
      expect(sanitizeUploadFilename('file\x00name.pdf')).toBe('filename.pdf');
      expect(sanitizeUploadFilename('fi\x1fle.txt')).toBe('file.txt');
    });

    it('collapses consecutive dots and strips leading dots', () => {
      expect(sanitizeUploadFilename('...hidden')).toBe('hidden');
      expect(sanitizeUploadFilename('file...name.pdf')).toBe('file.name.pdf');
    });
  });

  describe('Windows reserved name blocking', () => {
    it('returns fallback for reserved Windows device names', () => {
      expect(sanitizeUploadFilename('CON')).toBe('upload');
      expect(sanitizeUploadFilename('PRN.txt')).toBe('upload');
      expect(sanitizeUploadFilename('AUX.pdf')).toBe('upload');
      expect(sanitizeUploadFilename('NUL')).toBe('upload');
      expect(sanitizeUploadFilename('com1.log')).toBe('upload');
      expect(sanitizeUploadFilename('lpt3.doc')).toBe('upload');
    });

    it('allows non-reserved names through (case-insensitive check on stem)', () => {
      expect(sanitizeUploadFilename('COM10')).toBe('COM10');
      expect(sanitizeUploadFilename('LPT11')).toBe('LPT11');
      expect(sanitizeUploadFilename('document.pdf')).toBe('document.pdf');
    });
  });

  describe('length capping', () => {
    it('truncates filenames longer than 120 characters', () => {
      const longName = 'a'.repeat(150) + '.pdf';
      const result = sanitizeUploadFilename(longName);
      expect(result.length).toBeLessThanOrEqual(120);
      expect(result).toMatch(/\.pdf$/);
    });

    it('preserves extension when truncating long filenames', () => {
      const longName = 'a'.repeat(150) + '.mp3';
      const result = sanitizeUploadFilename(longName);
      expect(result).toMatch(/\.mp3$/);
    });
  });
});

describe('checkContentLength', () => {
  it('returns error 411 when Content-Length is missing', () => {
    const req = { headers: {} };
    const result = checkContentLength(req);
    expect(result.ok).toBe(false);
    expect(result.error.status).toBe(411);
    expect(result.error.code).toBe('LENGTH_REQUIRED');
  });

  it('returns error 411 when Content-Length is null', () => {
    const result = checkContentLength({ headers: { 'content-length': null } });
    expect(result.ok).toBe(false);
    expect(result.error.status).toBe(411);
  });

  it('returns ok with length when Content-Length is valid', () => {
    const req = { headers: { 'content-length': '1024' } };
    const result = checkContentLength(req);
    expect(result.ok).toBe(true);
    expect(result.length).toBe(1024);
  });

  it('returns error 413 when Content-Length exceeds max', () => {
    const req = { headers: { 'content-length': '50000000' } };
    const result = checkContentLength(req, 25 * 1024 * 1024);
    expect(result.ok).toBe(false);
    expect(result.error.status).toBe(413);
    expect(result.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('accepts Content-Length of zero', () => {
    const req = { headers: { 'content-length': '0' } };
    const result = checkContentLength(req);
    expect(result.ok).toBe(true);
    expect(result.length).toBe(0);
  });
});
