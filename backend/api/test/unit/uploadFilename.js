import { describe, it, expect } from 'vitest';
import { generateUploadFilename } from '../../src/lib/uploadFilename.js';

describe('uploadFilename utility', () => {
  it('should preserve valid extensions and clean basic filenames', () => {
    const filename = 'my-document.pdf';
    const result = generateUploadFilename(filename);
    
    expect(result).toMatch(/\.pdf$/);
    expect(result).not.toContain('..');
  });

  it('should prevent path traversal attacks by stripping directory traversal sequences', () => {
    const maliciousFilename = '../../etc/passwd.txt';
    const result = generateUploadFilename(maliciousFilename);

    expect(result).not.toContain('../');
    expect(result).not.toContain('..');
    expect(result).toMatch(/\.txt$/);
  });

  it('should strip unsafe special characters and spaces', () => {
    const filename = 'my test file!@#$.png';
    const result = generateUploadFilename(filename);

    expect(result).not.toContain('!');
    expect(result).not.toContain('@');
    expect(result).not.toContain('#');
    expect(result).toMatch(/\.png$/);
  });

  it('should handle empty or missing filenames gracefully with a fallback', () => {
    const resultEmpty = generateUploadFilename('');
    const resultNull = generateUploadFilename(null);

    expect(resultEmpty).toBeDefined();
    expect(typeof resultEmpty).toBe('string');
    expect(resultEmpty.length).toBeGreaterThan(0);

    expect(resultNull).toBeDefined();
    expect(typeof resultNull).toBe('string');
  });

  it('should properly normalize unicode filenames', () => {
    const unicodeFilename = 'café_document.pdf';
    const result = generateUploadFilename(unicodeFilename);

    expect(result).toBeDefined();
    expect(result).toMatch(/\.pdf$/);
  });
});
