import { describe, it, expect } from 'vitest';
import {
  detectDocumentMimeType,
  validateDocumentBuffer,
  DocumentValidationError,
  ALLOWED_DOCUMENT_MIME_TYPES,
} from '../../src/lib/documentValidation.js';

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const PDF_BYTES = Buffer.from('%PDF-1.4 rest of file', 'utf-8');
const EXECUTABLE_BYTES = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);

const ALLOWED_PHOTO_MIME_TYPES = ['image/jpeg', 'image/png'];

describe('Maintenance photo validation (using documentValidation)', () => {
  describe('detectDocumentMimeType for photos', () => {
    it('detects a JPEG', () => {
      expect(detectDocumentMimeType(JPEG_BYTES)).toBe('image/jpeg');
    });

    it('detects a PNG', () => {
      expect(detectDocumentMimeType(PNG_BYTES)).toBe('image/png');
    });

    it('returns null for an executable', () => {
      expect(detectDocumentMimeType(EXECUTABLE_BYTES)).toBeNull();
    });

    it('returns null for empty buffer', () => {
      expect(detectDocumentMimeType(Buffer.alloc(0))).toBeNull();
    });
  });

  describe('validateDocumentBuffer for photo uploads', () => {
    it('accepts a JPEG declared as image/jpeg', () => {
      expect(validateDocumentBuffer(JPEG_BYTES, 'image/jpeg')).toBe('image/jpeg');
    });

    it('accepts a PNG declared as image/png', () => {
      expect(validateDocumentBuffer(PNG_BYTES, 'image/png')).toBe('image/png');
    });

    it('accepts JPEG without declared type (content-based detection)', () => {
      expect(validateDocumentBuffer(JPEG_BYTES, undefined)).toBe('image/jpeg');
    });

    it('rejects an executable renamed to .jpg', () => {
      expect(() => validateDocumentBuffer(EXECUTABLE_BYTES, 'image/jpeg')).toThrow(
        DocumentValidationError
      );
    });

    it('rejects content/declared-type mismatch', () => {
      expect(() => validateDocumentBuffer(PNG_BYTES, 'image/jpeg')).toThrow(
        /does not match declared type/
      );
    });

    it('maintenance photo filter: PDF is detected but not a photo type', () => {
      const detected = detectDocumentMimeType(PDF_BYTES);
      expect(detected).toBe('application/pdf');
      expect(ALLOWED_PHOTO_MIME_TYPES).not.toContain(detected);
    });
  });
});
