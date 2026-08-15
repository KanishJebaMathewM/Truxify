import { describe, it, expect } from 'vitest';
import {
  detectDocumentMimeType,
  validateDocumentBuffer,
  matchesMimeSignature,
  DocumentValidationError,
  ALLOWED_DOCUMENT_MIME_TYPES,
} from '../../src/lib/documentValidation.js';

describe('documentValidation', () => {
  describe('detectDocumentMimeType', () => {
    it('detects JPEG from magic bytes', () => {
      const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
      expect(detectDocumentMimeType(jpegBuffer)).toBe('image/jpeg');
    });

    it('detects PNG from magic bytes', () => {
      const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(detectDocumentMimeType(pngBuffer)).toBe('image/png');
    });

    it('detects PDF from magic bytes', () => {
      const pdfBuffer = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
      expect(detectDocumentMimeType(pdfBuffer)).toBe('application/pdf');
    });

    it('returns null for empty buffer', () => {
      expect(detectDocumentMimeType(Buffer.alloc(0))).toBeNull();
    });

    it('returns null for null input', () => {
      expect(detectDocumentMimeType(null)).toBeNull();
    });

    it('returns null for unknown content', () => {
      const unknownBuffer = Buffer.from([0x00, 0x01, 0x02, 0x03]);
      expect(detectDocumentMimeType(unknownBuffer)).toBeNull();
    });

    it('returns null for incomplete JPEG header', () => {
      const shortBuffer = Buffer.from([0xff, 0xd8]);
      expect(detectDocumentMimeType(shortBuffer)).toBeNull();
    });
  });

  describe('validateDocumentBuffer', () => {
    it('accepts valid JPEG buffer', () => {
      const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
      expect(validateDocumentBuffer(jpegBuffer)).toBe('image/jpeg');
    });

    it('accepts valid PNG buffer', () => {
      const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(validateDocumentBuffer(pngBuffer)).toBe('image/png');
    });

    it('accepts valid PDF buffer', () => {
      const pdfBuffer = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]);
      expect(validateDocumentBuffer(pdfBuffer)).toBe('application/pdf');
    });

    it('throws DocumentValidationError for invalid content', () => {
      const unknownBuffer = Buffer.from([0x00, 0x01, 0x02, 0x03]);
      expect(() => validateDocumentBuffer(unknownBuffer)).toThrow(DocumentValidationError);
    });

    it('throws for null buffer', () => {
      expect(() => validateDocumentBuffer(null)).toThrow(DocumentValidationError);
    });

    it('rejects MIME mismatch', () => {
      const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
      expect(() => validateDocumentBuffer(jpegBuffer, 'image/png')).toThrow('does not match declared type');
    });

    it('accepts matching declared MIME type', () => {
      const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
      expect(validateDocumentBuffer(jpegBuffer, 'image/jpeg')).toBe('image/jpeg');
    });
  });

  describe('matchesMimeSignature', () => {
    it('matches PNG signature', () => {
      const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(matchesMimeSignature(pngBuffer, 'image/png')).toBe(true);
    });

    it('matches JPEG signature', () => {
      const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
      expect(matchesMimeSignature(jpegBuffer, 'image/jpeg')).toBe(true);
    });

    it('returns false for wrong mime type', () => {
      const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
      expect(matchesMimeSignature(jpegBuffer, 'image/png')).toBe(false);
    });

    it('returns false for short buffer', () => {
      const shortBuffer = Buffer.from([0xff, 0xd8]);
      expect(matchesMimeSignature(shortBuffer, 'image/jpeg')).toBe(false);
    });

    it('returns false for null', () => {
      expect(matchesMimeSignature(null, 'image/jpeg')).toBe(false);
    });
  });

  describe('DocumentValidationError', () => {
    it('has correct name', () => {
      const err = new DocumentValidationError('test');
      expect(err.name).toBe('DocumentValidationError');
      expect(err instanceof Error).toBe(true);
    });
  });

  describe('ALLOWED_DOCUMENT_MIME_TYPES', () => {
    it('contains expected MIME types', () => {
      expect(ALLOWED_DOCUMENT_MIME_TYPES).toContain('image/jpeg');
      expect(ALLOWED_DOCUMENT_MIME_TYPES).toContain('image/png');
      expect(ALLOWED_DOCUMENT_MIME_TYPES).toContain('application/pdf');
    });

    it('is frozen', () => {
      expect(Object.isFrozen(ALLOWED_DOCUMENT_MIME_TYPES)).toBe(true);
    });
  });
});
