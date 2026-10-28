import { describe, it, expect } from 'vitest';
import fileValidator, {
  validateFile,
  detectFileType,
  computeSHA256Hash,
  sanitizeFileName,
  MAX_FILE_SIZE_BYTES,
} from '../../src/utils/fileValidator.js';

const PDF_BYTES = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n', 'ascii');
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

// The real module, not a mock: documentService and r2StorageService import its
// default export, which only exists if the file is a valid ES module.
describe('fileValidator (ES module)', () => {
  it('exposes the same helpers as named and default exports', () => {
    expect(fileValidator.validateFile).toBe(validateFile);
    expect(fileValidator.computeSHA256Hash).toBe(computeSHA256Hash);
    expect(fileValidator.sanitizeFileName).toBe(sanitizeFileName);
    expect(fileValidator.MAX_FILE_SIZE_BYTES).toBe(10 * 1024 * 1024);
  });

  it('accepts files whose bytes match the declared type and extension', () => {
    const pdf = { size: PDF_BYTES.length, buffer: PDF_BYTES, mimetype: 'application/pdf', originalname: 'rc.pdf' };
    const jpeg = { size: JPEG_BYTES.length, buffer: JPEG_BYTES, mimetype: 'image/jpeg', originalname: 'photo.jpg' };
    const png = { size: PNG_BYTES.length, buffer: PNG_BYTES, mimetype: 'image/png', originalname: 'scan.png' };

    expect(validateFile(pdf)).toBe(true);
    expect(validateFile(jpeg)).toBe(true);
    expect(validateFile(png)).toBe(true);
    expect(detectFileType(PDF_BYTES)).toBe('application/pdf');
    expect(detectFileType(JPEG_BYTES)).toBe('image/jpeg');
    expect(detectFileType(PNG_BYTES)).toBe('image/png');
  });

  it('rejects bad MIME type, extension and oversized files before inspecting bytes', () => {
    const ok = { size: PDF_BYTES.length, buffer: PDF_BYTES, mimetype: 'application/pdf', originalname: 'rc.pdf' };
    expect(() => validateFile(null)).toThrow('No file provided');
    expect(() => validateFile({ ...ok, mimetype: 'text/html' })).toThrow('Invalid file type');
    expect(() => validateFile({ ...ok, originalname: 'rc.exe' })).toThrow('Invalid file extension');
    expect(() => validateFile({ ...ok, size: MAX_FILE_SIZE_BYTES + 1 })).toThrow('File size exceeds');
  });

  it('rejects HTML, SVG and truncated payloads disguised as documents', () => {
    const html = Buffer.from('<html><script>alert(1)</script></html>', 'utf8');
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf8');
    const truncated = Buffer.from('%PDF', 'ascii');

    expect(() => validateFile({
      size: html.length,
      buffer: html,
      mimetype: 'application/pdf',
      originalname: 'invoice.pdf',
    })).toThrow('Unable to verify file content type');

    expect(() => validateFile({
      size: svg.length,
      buffer: svg,
      mimetype: 'image/png',
      originalname: 'seal.png',
    })).toThrow('Unable to verify file content type');

    expect(() => validateFile({
      size: truncated.length,
      buffer: truncated,
      mimetype: 'application/pdf',
      originalname: 'invoice.pdf',
    })).toThrow('signature');

    expect(() => validateFile({
      size: PDF_BYTES.length,
      buffer: PDF_BYTES,
      mimetype: 'image/png',
      originalname: 'seal.png',
    })).toThrow('File content does not match');
  });

  it('rejects a file with no buffer because the content cannot be verified', () => {
    expect(() => validateFile({
      size: 1024,
      mimetype: 'application/pdf',
      originalname: 'rc.pdf',
    })).toThrow('File content is required');
  });

  it('hashes with SHA-256 and renames files keeping only the extension', () => {
    expect(computeSHA256Hash(Buffer.from('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sanitizeFileName('../../etc/Passwd.PNG')).toMatch(/^\d+-[a-z0-9]+\.png$/);
  });
});
