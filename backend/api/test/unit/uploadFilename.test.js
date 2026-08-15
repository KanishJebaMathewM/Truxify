/**
 * Coverage for upload filename sanitisation.
 *
 * `file.originalname` is entirely client-controlled and previously flowed
 * unsanitised from the voice upload endpoint into the speech pipeline.
 */
import { describe, expect, it } from 'vitest';
import { checkContentLength, sanitizeUploadFilename } from '../../src/lib/uploadFilename.js';

describe('sanitizeUploadFilename', () => {
  it('returns the filename unchanged when it is already safe', () => {
    expect(sanitizeUploadFilename('document.pdf')).toBe('document.pdf');
    expect(sanitizeUploadFilename('photo_2024.jpg')).toBe('photo_2024.jpg');
    expect(sanitizeUploadFilename('report-v2.xlsx')).toBe('report-v2.xlsx');
  });

  it('strips Unix directory separators', () => {
    expect(sanitizeUploadFilename('uploads/photo.jpg')).toBe('photo.jpg');
    expect(sanitizeUploadFilename('/etc/passwd')).toBe('passwd');
  });

  it('strips Windows directory separators', () => {
    expect(sanitizeUploadFilename('uploads\\photo.jpg')).toBe('photo.jpg');
    expect(sanitizeUploadFilename('C:\\Windows\\System32\\config')).toBe('config');
  });

  it('strips mixed path separators', () => {
    expect(sanitizeUploadFilename('dir/subdir\\mixed/path/file.png')).toBe('file.png');
  });

  it('strips path traversal sequences', () => {
    expect(sanitizeUploadFilename('../../../etc/passwd')).toBe('passwd');
    expect(sanitizeUploadFilename('foo/../bar/baz.txt')).toBe('baz.txt');
    expect(sanitizeUploadFilename('....//....//etc/passwd')).toBe('passwd');
  });

  it('drops control characters and NUL bytes', () => {
    expect(sanitizeUploadFilename('doc\x00ument.pdf')).toBe('document.pdf');
    expect(sanitizeUploadFilename('file\x1f.txt')).toBe('file.txt');
    expect(sanitizeUploadFilename('photo\x7f.jpg')).toBe('photo.jpg');
  });

  it('normalises non-allowlisted characters to underscores', () => {
    expect(sanitizeUploadFilename('my document (1).pdf')).toBe('my_document__1_.pdf');
    expect(sanitizeUploadFilename('price list [copy].xlsx')).toBe('price_list__copy_.xlsx');
    expect(sanitizeUploadFilename('file with spaces.txt')).toBe('file_with_spaces.txt');
  });

  it('collapses consecutive dots and strips leading dots', () => {
    expect(sanitizeUploadFilename('...hidden...file...')).toBe('hidden.file.');
    expect(sanitizeUploadFilename('.hidden.pdf')).toBe('hidden.pdf');
    expect(sanitizeUploadFilename('...file.txt')).toBe('file.txt');
  });

  it('truncates long filenames preserving the extension', () => {
    const longBase = 'a'.repeat(150);
    const result = sanitizeUploadFilename(`${longBase}.txt`);
    expect(result.length).toBeLessThanOrEqual(120);
    expect(result.endsWith('.txt')).toBe(true);
  });

  it('returns fallback when name becomes empty after sanitisation', () => {
    expect(sanitizeUploadFilename('', 'default.txt')).toBe('default.txt');
    expect(sanitizeUploadFilename(null, 'fallback.pdf')).toBe('fallback.pdf');
    expect(sanitizeUploadFilename(undefined, 'backup.jpg')).toBe('backup.jpg');
  });

  it('rejects Windows reserved device names regardless of extension', () => {
    expect(sanitizeUploadFilename('nul.pdf')).toBe('upload');
    expect(sanitizeUploadFilename('aux')).toBe('upload');
    expect(sanitizeUploadFilename('com1.txt')).toBe('upload');
    expect(sanitizeUploadFilename('lpt9')).toBe('upload');
    expect(sanitizeUploadFilename('prn')).toBe('upload');
  });

  it('allows mixed-case filenames (case is preserved)', () => {
    // Only the stem (part before extension) is lowercased for reserved-name check
    // The full filename retains its original case
    expect(sanitizeUploadFilename('FILE123.TXT')).toBe('FILE123.TXT');
    expect(sanitizeUploadFilename('Report_2024_V2.PDF')).toBe('Report_2024_V2.PDF');
  });

  it('handles filenames with only extension', () => {
    // Leading dots are stripped, so .pdf becomes pdf which is not reserved
    expect(sanitizeUploadFilename('.pdf')).toBe('pdf');
    // ... collapses to . which then is stripped, leaving empty string
    expect(sanitizeUploadFilename('...')).toBe('upload');
  });

  it('uses custom fallback when provided', () => {
    expect(sanitizeUploadFilename('', 'my_fallback')).toBe('my_fallback');
    expect(sanitizeUploadFilename(null, 'backup')).toBe('backup');
    // ... becomes empty string after sanitisation, triggering fallback
    expect(sanitizeUploadFilename('...', 'safe_doc')).toBe('safe_doc');
    // nul is reserved regardless of extension
    expect(sanitizeUploadFilename('nul.pdf', 'my_fallback')).toBe('my_fallback');
  });
});

// === Spec 18 test ===
describe('checkContentLength', () => {
  it('returns ok when content-length is within limit', () => {
    const req = { headers: { 'content-length': '1024' } };
    const result = checkContentLength(req, 10240);
    expect(result.ok).toBe(true);
    expect(result.length).toBe(1024);
  });

  it('returns ok when content-length equals the limit', () => {
    const req = { headers: { 'content-length': '1024' } };
    const result = checkContentLength(req, 1024);
    expect(result.ok).toBe(true);
  });

  it('returns error when content-length exceeds the limit', () => {
    const req = { headers: { 'content-length': '50000' } };
    const result = checkContentLength(req, 1024);
    expect(result.ok).toBe(false);
    expect(result.error.status).toBe(413);
    expect(result.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('returns ok when content-length header is missing', () => {
    const req = { headers: {} };
    const result = checkContentLength(req, 1000);
    expect(result.ok).toBe(true);
    expect(result.length).toBe(0);
  });
});

describe('sanitizeUploadFilename - additional edge cases', () => {
  it('handles whitespace-only string as fallback', () => {
    expect(sanitizeUploadFilename('   ', 'doc')).toBe('doc');
  });

  it('preserves file extension when collapsing characters', () => {
    const result = sanitizeUploadFilename('my<>file.pdf');
    expect(result.endsWith('.pdf')).toBe(true);
    expect(result).not.toContain('<');
    expect(result).not.toContain('>');
  });
});
