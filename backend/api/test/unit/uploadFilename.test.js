import { describe, it, expect } from 'vitest';
import { sanitizeUploadFilename, isValidUploadFilename } from '../../src/lib/uploadFilename.js';

describe('uploadFilename', () => {
  describe('sanitizeUploadFilename', () => {
    it('returns original name when safe', () => {
      expect(sanitizeUploadFilename('document.pdf', 'default')).toBe('document.pdf');
    });


  it('strips directory traversal sequences', () => {
    // Only the basename survives directory stripping; traversal segments are
    // removed entirely.
    expect(sanitizeUploadFilename('../../../etc/passwd', 'default')).toBe('passwd');
  });

  it('strips backslash traversal on POSIX', () => {
    expect(sanitizeUploadFilename('..\\..\\etc\\passwd', 'default')).toBe('passwd');
  });

  it('strips control characters', () => {
    expect(sanitizeUploadFilename('file\x00name.pdf', 'default')).toBe('filename.pdf');
  });

  it('truncates to MAX_FILENAME_LENGTH characters', () => {
    const longName = 'a'.repeat(150) + '.pdf';
    const result = sanitizeUploadFilename(longName, 'default');
    expect(result.length).toBeLessThanOrEqual(120);
    expect(result.endsWith('.pdf')).toBe(true);
  });

  it('re-normalizes a truncated filename that ends in dots', () => {
    // The truncated extension slice can reintroduce a run of dots; the
    // result must not contain a traversal segment or a leading dot.
    const result = sanitizeUploadFilename('a'.repeat(140) + '....', 'default');
    expect(result).not.toContain('..');
    expect(result).not.toMatch(/^\./);
    expect(result.length).toBeLessThanOrEqual(120);
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns fallback for empty string', () => {
    expect(sanitizeUploadFilename('', 'default')).toBe('default');
    expect(sanitizeUploadFilename(null, 'default')).toBe('default');
  });

  it('rejects Windows reserved names', () => {
    expect(sanitizeUploadFilename('CON.pdf', 'default')).toBe('default');
    expect(sanitizeUploadFilename('PRN.txt', 'default')).toBe('default');
    expect(sanitizeUploadFilename('AUX.doc', 'default')).toBe('default');
    expect(sanitizeUploadFilename('NUL.pdf', 'default')).toBe('default');
  });

  it('removes leading dots', () => {
    expect(sanitizeUploadFilename('...hidden.pdf', 'default')).toBe('hidden.pdf');
  });

  it('replaces unicode lookalikes with underscores', () => {
    expect(sanitizeUploadFilename('fíle.pdf', 'default')).toBe('fi_le.pdf');
  });

  it('collapses multiple dots', () => {
    expect(sanitizeUploadFilename('file...name.pdf', 'default')).toBe('file.name.pdf');
  });
});

  describe('isValidUploadFilename', () => {
    it('returns true for safe filenames', () => {
      expect(isValidUploadFilename('document.pdf')).toBe(true);
      expect(isValidUploadFilename('driver_license_2026.png')).toBe(true);
    });

    it('returns false for unsafe or traversal filenames', () => {
      expect(isValidUploadFilename('../../../etc/passwd')).toBe(false);
      expect(isValidUploadFilename('CON.pdf')).toBe(false);
      expect(isValidUploadFilename(null)).toBe(false);
    });
  });
});

