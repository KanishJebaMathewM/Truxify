import { describe, it, expect } from 'vitest';
import fileValidator, {
  validateFile,
  computeSHA256Hash,
  sanitizeFileName,
  MAX_FILE_SIZE_BYTES,
} from '../../src/utils/fileValidator.js';

// The real module, not a mock: documentService and r2StorageService import its
// default export, which only exists if the file is a valid ES module.
describe('fileValidator (ES module)', () => {
  it('exposes the same helpers as named and default exports', () => {
    expect(fileValidator.validateFile).toBe(validateFile);
    expect(fileValidator.computeSHA256Hash).toBe(computeSHA256Hash);
    expect(fileValidator.sanitizeFileName).toBe(sanitizeFileName);
    expect(fileValidator.MAX_FILE_SIZE_BYTES).toBe(10 * 1024 * 1024);
  });

  it('accepts an allowed file and rejects bad type, extension and size', () => {
    const ok = { size: 1024, mimetype: 'application/pdf', originalname: 'rc.pdf' };
    expect(validateFile(ok)).toBe(true);
    expect(() => validateFile(null)).toThrow('No file provided');
    expect(() => validateFile({ ...ok, mimetype: 'text/html' })).toThrow('Invalid file type');
    expect(() => validateFile({ ...ok, originalname: 'rc.exe' })).toThrow('Invalid file extension');
    expect(() => validateFile({ ...ok, size: MAX_FILE_SIZE_BYTES + 1 })).toThrow('File size exceeds');
  });

  it('hashes with SHA-256 and renames files keeping only the extension', () => {
    expect(computeSHA256Hash(Buffer.from('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sanitizeFileName('../../etc/Passwd.PNG')).toMatch(/^\d+-[a-z0-9]+\.png$/);
  });
});
