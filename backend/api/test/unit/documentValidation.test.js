import { describe, it, expect } from 'vitest';
import {
  detectDocumentMimeType,
  validateDocumentBuffer,
  matchesMimeSignature,
  DocumentValidationError,
  ALLOWED_DOCUMENT_MIME_TYPES,
} from '../../src/lib/documentValidation.js';

/** Build a buffer from leading bytes, padded so length checks pass. */
function withHeader(bytes, totalLength = 64) {
  const buf = Buffer.alloc(totalLength);
  Buffer.from(bytes).copy(buf, 0);
  return buf;
}

// Sample document fixtures with valid magic bytes
const JPEG = withHeader([0xff, 0xd8, 0xff, 0xe0]);
const PNG = withHeader([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF = withHeader([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // "%PDF-1.4"

// Disallowed formats and mock container fixtures
const GIF = withHeader([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // "GIF89a"
const ZIP = withHeader([0x50, 0x4b, 0x03, 0x04]);
const ELF = withHeader([0x7f, 0x45, 0x4c, 0x46]);
const MP3 = withHeader([0x49, 0x44, 0x33, 0x04, 0x00]);
const HTML = Buffer.from('<!DOCTYPE html><html><body>malicious payload</body></html>');

describe('documentValidation', () => {
  describe('detectDocumentMimeType', () => {
    it('detects JPEG from magic bytes (FF D8 FF)', () => {
      expect(detectDocumentMimeType(JPEG)).toBe('image/jpeg');
      expect(detectDocumentMimeType(Buffer.from([0xff, 0xd8, 0xff]))).toBe('image/jpeg');
    });

    it('detects PNG from magic bytes (89 50 4E 47 0D 0A 1A 0A)', () => {
      expect(detectDocumentMimeType(PNG)).toBe('image/png');
    });

    it('detects PDF from magic bytes (%PDF / 25 50 44 46)', () => {
      expect(detectDocumentMimeType(PDF)).toBe('application/pdf');
    });

    it('returns null for empty buffer', () => {
      expect(detectDocumentMimeType(Buffer.alloc(0))).toBeNull();
    });

    it('returns null gracefully for null or undefined input', () => {
      expect(detectDocumentMimeType(null)).toBeNull();
      expect(detectDocumentMimeType(undefined)).toBeNull();
    });

    it('returns null gracefully for non-buffer inputs', () => {
      expect(detectDocumentMimeType('data:image/jpeg;base64,...')).toBeNull();
      expect(detectDocumentMimeType(12345)).toBeNull();
      expect(detectDocumentMimeType({})).toBeNull();
      expect(detectDocumentMimeType([0xff, 0xd8, 0xff])).toBeNull();
    });

    it('returns null for unknown content and disallowed containers', () => {
      expect(detectDocumentMimeType(Buffer.from([0x00, 0x01, 0x02, 0x03]))).toBeNull();
      expect(detectDocumentMimeType(GIF)).toBeNull();
      expect(detectDocumentMimeType(ZIP)).toBeNull();
      expect(detectDocumentMimeType(ELF)).toBeNull();
      expect(detectDocumentMimeType(MP3)).toBeNull();
      expect(detectDocumentMimeType(HTML)).toBeNull();
    });

    it('returns null for truncated/incomplete magic byte headers', () => {
      expect(detectDocumentMimeType(Buffer.from([0xff, 0xd8]))).toBeNull();
      expect(detectDocumentMimeType(Buffer.from([0x89, 0x50, 0x4e]))).toBeNull();
      expect(detectDocumentMimeType(Buffer.from([0x25, 0x50, 0x44]))).toBeNull();
    });
  });

  describe('validateDocumentBuffer', () => {
    it('accepts valid JPEG buffer and returns verified MIME type', () => {
      expect(validateDocumentBuffer(JPEG)).toBe('image/jpeg');
    });

    it('accepts valid PNG buffer and returns verified MIME type', () => {
      expect(validateDocumentBuffer(PNG)).toBe('image/png');
    });

    it('accepts valid PDF buffer and returns verified MIME type', () => {
      expect(validateDocumentBuffer(PDF)).toBe('application/pdf');
    });

    it('accepts valid buffer when matching declared MIME type is provided', () => {
      expect(validateDocumentBuffer(JPEG, 'image/jpeg')).toBe('image/jpeg');
      expect(validateDocumentBuffer(PNG, 'image/png')).toBe('image/png');
      expect(validateDocumentBuffer(PDF, 'application/pdf')).toBe('application/pdf');
    });

    it('throws DocumentValidationError when buffer is null or undefined', () => {
      expect(() => validateDocumentBuffer(null)).toThrow(DocumentValidationError);
      expect(() => validateDocumentBuffer(null)).toThrow('Document buffer is null or undefined.');
      expect(() => validateDocumentBuffer(undefined)).toThrow(DocumentValidationError);
      expect(() => validateDocumentBuffer(undefined)).toThrow('Document buffer is null or undefined.');
    });

    it('throws DocumentValidationError when buffer is empty or non-buffer', () => {
      expect(() => validateDocumentBuffer(Buffer.alloc(0))).toThrow(DocumentValidationError);
      expect(() => validateDocumentBuffer(Buffer.alloc(0))).toThrow('Document buffer is empty.');
      expect(() => validateDocumentBuffer('not-a-buffer')).toThrow(DocumentValidationError);
      expect(() => validateDocumentBuffer('not-a-buffer')).toThrow('Document buffer is empty.');
    });

    it('throws DocumentValidationError for invalid content or disallowed file types', () => {
      const invalidBuffer = Buffer.from([0x00, 0x01, 0x02, 0x03]);
      expect(() => validateDocumentBuffer(invalidBuffer)).toThrow(DocumentValidationError);
      expect(() => validateDocumentBuffer(invalidBuffer)).toThrow(
        'Invalid document type: unknown. Only JPEG, PNG, and PDF are accepted.'
      );

      expect(() => validateDocumentBuffer(GIF)).toThrow(DocumentValidationError);
      expect(() => validateDocumentBuffer(ZIP)).toThrow(DocumentValidationError);
      expect(() => validateDocumentBuffer(ELF)).toThrow(DocumentValidationError);
      expect(() => validateDocumentBuffer(HTML)).toThrow(DocumentValidationError);
    });

    it('throws DocumentValidationError when detected MIME type does not match declared type', () => {
      expect(() => validateDocumentBuffer(JPEG, 'image/png')).toThrow(DocumentValidationError);
      expect(() => validateDocumentBuffer(JPEG, 'image/png')).toThrow(
        'File content (image/jpeg) does not match declared type (image/png).'
      );

      expect(() => validateDocumentBuffer(PNG, 'application/pdf')).toThrow(DocumentValidationError);
      expect(() => validateDocumentBuffer(PNG, 'application/pdf')).toThrow(
        'File content (image/png) does not match declared type (application/pdf).'
      );

      expect(() => validateDocumentBuffer(PDF, 'image/jpeg')).toThrow(DocumentValidationError);
      expect(() => validateDocumentBuffer(PDF, 'image/jpeg')).toThrow(
        'File content (application/pdf) does not match declared type (image/jpeg).'
      );
    });

    it('ensures only known-safe document container signatures are accepted', () => {
      for (const buffer of [JPEG, PNG, PDF]) {
        const detected = validateDocumentBuffer(buffer);
        expect(ALLOWED_DOCUMENT_MIME_TYPES).toContain(detected);
      }
    });

    it('treats an empty or whitespace-only declared type as absent (#11030)', () => {
      expect(validateDocumentBuffer(PDF, '')).toBe('application/pdf');
      expect(validateDocumentBuffer(PDF, '   ')).toBe('application/pdf');
    });

    it('compares the declared type case-insensitively (#11030)', () => {
      expect(validateDocumentBuffer(JPEG, 'IMAGE/JPEG')).toBe('image/jpeg');
      expect(validateDocumentBuffer(PNG, 'Image/PNG')).toBe('image/png');
      expect(validateDocumentBuffer(PDF, ' application/pdf ')).toBe('application/pdf');
    });

    it('still rejects a declared type that does not match the content', () => {
      expect(() => validateDocumentBuffer(PDF, 'IMAGE/JPEG')).toThrow(DocumentValidationError);
    });
  });

  describe('matchesMimeSignature', () => {
    it('matches PNG signature correctly', () => {
      expect(matchesMimeSignature(PNG, 'image/png')).toBe(true);
      expect(matchesMimeSignature(JPEG, 'image/png')).toBe(false);
    });

    it('matches JPEG signature correctly', () => {
      expect(matchesMimeSignature(JPEG, 'image/jpeg')).toBe(true);
      expect(matchesMimeSignature(PNG, 'image/jpeg')).toBe(false);
    });

    it('matches PDF signature correctly', () => {
      expect(matchesMimeSignature(PDF, 'application/pdf')).toBe(true);
      expect(matchesMimeSignature(JPEG, 'application/pdf')).toBe(false);
    });

    it('matches GIF signature correctly', () => {
      expect(matchesMimeSignature(GIF, 'image/gif')).toBe(true);
      expect(matchesMimeSignature(JPEG, 'image/gif')).toBe(false);
    });

    it('returns true for unknown MIME types where no specific signature is registered', () => {
      expect(matchesMimeSignature(JPEG, 'text/plain')).toBe(true);
    });

    it('returns false for null, non-buffer, or buffer shorter than 4 bytes', () => {
      expect(matchesMimeSignature(null, 'image/jpeg')).toBe(false);
      expect(matchesMimeSignature(undefined, 'image/jpeg')).toBe(false);
      expect(matchesMimeSignature('invalid', 'image/jpeg')).toBe(false);
      expect(matchesMimeSignature(Buffer.from([0xff, 0xd8]), 'image/jpeg')).toBe(false);
    });
  });

  describe('DocumentValidationError', () => {
    it('is an instance of Error with correct name and message', () => {
      const err = new DocumentValidationError('Validation failed');
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(DocumentValidationError);
      expect(err.name).toBe('DocumentValidationError');
      expect(err.message).toBe('Validation failed');
    });
  });

  describe('ALLOWED_DOCUMENT_MIME_TYPES', () => {
    it('contains exactly image/jpeg, image/png, and application/pdf', () => {
      expect(ALLOWED_DOCUMENT_MIME_TYPES).toEqual([
        'image/jpeg',
        'image/png',
        'application/pdf',
      ]);
    });

    it('is an immutable frozen object', () => {
      expect(Object.isFrozen(ALLOWED_DOCUMENT_MIME_TYPES)).toBe(true);
    });
  });
});
