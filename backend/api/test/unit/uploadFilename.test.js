import { describe, it, expect } from 'vitest';
import { sanitizeUploadFilename } from '../../src/lib/uploadFilename.js';

describe('sanitizeUploadFilename', () => {
  it('returns the fallback for null', () => {
    expect(sanitizeUploadFilename(null)).toBe('upload');
    expect(sanitizeUploadFilename(null, 'doc')).toBe('doc');
  });

  it('returns the fallback for empty string', () => {
    expect(sanitizeUploadFilename('')).toBe('upload');
    expect(sanitizeUploadFilename('', 'custom')).toBe('custom');
  });

  it('returns the fallback for non-string input', () => {
    expect(sanitizeUploadFilename(123)).toBe('upload');
    expect(sanitizeUploadFilename({})).toBe('upload');
  });

  it('strips directory paths (Unix)', () => {
    const result = sanitizeUploadFilename('/path/to/file.pdf');
    expect(result).toBe('file.pdf');
  });

  it('strips directory paths (Windows)', () => {
    const result = sanitizeUploadFilename('C:\\Users\\test\\document.docx');
    expect(result).toBe('document.docx');
  });

  it('strips traversal sequences', () => {
    const result = sanitizeUploadFilename('../../../etc/passwd');
    expect(result).not.toContain('..');
    expect(result).not.toContain('passwd');
  });

  it('replaces special characters with underscore', () => {
    const result = sanitizeUploadFilename('file<>:"|?*.pdf');
    expect(result).toBe('file_______.pdf');
  });

  it('preserves alphanumeric, dot, hyphen, underscore', () => {
    const result = sanitizeUploadFilename('my-file_v2.pdf');
    expect(result).toBe('my-file_v2.pdf');
  });

  it('rejects Windows reserved device names', () => {
    const result = sanitizeUploadFilename('nul.txt');
    expect(result).toBe('upload');
  });

  it('uses custom fallback when provided', () => {
    expect(sanitizeUploadFilename(null, 'my-doc')).toBe('my-doc');
    expect(sanitizeUploadFilename('', 'fallback')).toBe('fallback');
  });
});
