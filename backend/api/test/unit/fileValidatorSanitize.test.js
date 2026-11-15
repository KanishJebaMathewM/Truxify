import { describe, it, expect } from 'vitest';
import { sanitizeFileName } from '../../src/utils/fileValidator.js';

describe('sanitizeFileName path traversal and extension sanitization', () => {
  it('preserves valid extension in sanitized filename', () => {
    const result = sanitizeFileName('driver_license.pdf');
    expect(result).toMatch(/^\d+-[a-f0-9]{8}\.pdf$/);
  });

  it('handles null, undefined, or empty string gracefully', () => {
    expect(sanitizeFileName(null)).toMatch(/^\d+-[a-f0-9]{8}$/);
    expect(sanitizeFileName(undefined)).toMatch(/^\d+-[a-f0-9]{8}$/);
    expect(sanitizeFileName('')).toMatch(/^\d+-[a-f0-9]{8}$/);
  });

  it('handles filenames without extensions safely without path traversal', () => {
    const result = sanitizeFileName('../../etc/passwd');
    expect(result).toMatch(/^\d+-[a-f0-9]{8}$/);
    expect(result).not.toContain('..');
    expect(result).not.toContain('/');
  });

  it('strips unsafe characters from extensions', () => {
    const result = sanitizeFileName('invoice.pdf;rm -rf');
    expect(result).not.toContain(';');
    expect(result).not.toContain(' ');
  });

  it('normalizes uppercase extensions to lowercase', () => {
    const result = sanitizeFileName('IMAGE.JPEG');
    expect(result).toMatch(/^\d+-[a-f0-9]{8}\.jpeg$/);
  });
});
