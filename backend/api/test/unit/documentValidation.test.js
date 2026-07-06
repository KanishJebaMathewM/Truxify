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
const EXECUTABLE_BYTES = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]); // MZ header
const SHELL_SCRIPT_RENAMED_AS_JPG = Buffer.from('#!/bin/sh\nrm -rf /\n', 'utf-8');

describe('detectDocumentMimeType', () => {
  it('detects a real JPEG by its magic bytes', () => {
    expect(detectDocumentMimeType(JPEG_BYTES)).toBe('image/jpeg');
  });

  it('detects a real PNG by its magic bytes', () => {
    expect(detectDocumentMimeType(PNG_BYTES)).toBe('image/png');
  });

  it('detects a real PDF by its magic bytes', () => {
    expect(detectDocumentMimeType(PDF_BYTES)).toBe('application/pdf');
  });

  it('returns null for an executable renamed to look like an image', () => {
    expect(detectDocumentMimeType(EXECUTABLE_BYTES)).toBeNull();
  });

  it('returns null for a shell script renamed to .jpg', () => {
    expect(detectDocumentMimeType(SHELL_SCRIPT_RENAMED_AS_JPG)).toBeNull();
  });

  it('returns null for an empty buffer', () => {
    expect(detectDocumentMimeType(Buffer.alloc(0))).toBeNull();
  });

  it('returns null for a non-buffer input', () => {
    expect(detectDocumentMimeType('not a buffer')).toBeNull();
  });

  it('only ever reports allowed document mime types', () => {
    for (const buf of [JPEG_BYTES, PNG_BYTES, PDF_BYTES]) {
      const detected = detectDocumentMimeType(buf);
      expect(ALLOWED_DOCUMENT_MIME_TYPES).toContain(detected);
    }
  });
});

describe('validateDocumentBuffer', () => {
  it('accepts a real JPEG declared as image/jpeg', () => {
    expect(validateDocumentBuffer(JPEG_BYTES, 'image/jpeg')).toBe('image/jpeg');
  });

  it('rejects an executable renamed to .jpg, regardless of declared type', () => {
    expect(() => validateDocumentBuffer(EXECUTABLE_BYTES, 'image/jpeg')).toThrow(
      DocumentValidationError
    );
  });

  it('rejects content whose real type does not match the declared type', () => {
    expect(() => validateDocumentBuffer(PNG_BYTES, 'image/jpeg')).toThrow(
      /does not match declared type/
    );
  });

  it('accepts content when no declared type is provided, based on content alone', () => {
    expect(validateDocumentBuffer(PDF_BYTES, undefined)).toBe('application/pdf');
  });
});
