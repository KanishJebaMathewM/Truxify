import { describe, it, expect } from 'vitest';
import {
  detectDocumentMimeType,
  validateDocumentBuffer,
  matchesMimeSignature,
  DocumentValidationError,
  ALLOWED_DOCUMENT_MIME_TYPES,
} from '../../../src/lib/documentValidation.js';

function hexToBuffer(hexString) {
  const bytes = hexString.replace(/\s+/g, '').match(/.{2}/g).map(b => parseInt(b, 16));
  return Buffer.from(bytes);
}

describe('detectDocumentMimeType', () => {
  it('returns null for null/undefined input', () => {
    expect(detectDocumentMimeType(null)).toBeNull();
    expect(detectDocumentMimeType(undefined)).toBeNull();
  });

  it('returns null for non-Buffer input', () => {
    expect(detectDocumentMimeType('string')).toBeNull();
    expect(detectDocumentMimeType(Buffer.alloc(0))).toBeNull();
    expect(detectDocumentMimeType({})).toBeNull();
  });

  it('detects JPEG from magic bytes', () => {
    const jpeg = hexToBuffer('ff d8 ff e0 00 10 4a 46 49 46');
    expect(detectDocumentMimeType(jpeg)).toBe('image/jpeg');
  });

  it('detects PNG from magic bytes', () => {
    const png = hexToBuffer('89 50 4e 47 0d 0a 1a 0a 00 00');
    expect(detectDocumentMimeType(png)).toBe('image/png');
  });

  it('detects PDF from magic bytes', () => {
    const pdf = hexToBuffer('25 50 44 46 2d 31 2e 34 0a');
    expect(detectDocumentMimeType(pdf)).toBe('application/pdf');
  });

  it('returns null for unknown magic bytes', () => {
    const unknown = hexToBuffer('01 02 03 04 05 06 07 08');
    expect(detectDocumentMimeType(unknown)).toBeNull();
  });

  it('returns null when buffer is too short for any signature', () => {
    const short = hexToBuffer('ff d8');
    expect(detectDocumentMimeType(short)).toBeNull();
  });
});

describe('validateDocumentBuffer', () => {
  it('throws DocumentValidationError for null buffer', () => {
    expect(() => validateDocumentBuffer(null)).toThrow(DocumentValidationError);
    expect(() => validateDocumentBuffer(null)).toThrow('null or undefined');
  });

  it('throws for detected disallowed type', () => {
    // GIF magic bytes are not in ALLOWED_DOCUMENT_MIME_TYPES
    const gif = hexToBuffer('47 49 46 38 39 61 10 10');
    expect(() => validateDocumentBuffer(gif)).toThrow(DocumentValidationError);
    expect(() => validateDocumentBuffer(gif)).toThrow(/Invalid document type/);
  });

  it('returns detected MIME when allowed and no declared type', () => {
    const jpeg = hexToBuffer('ff d8 ff e0 00 10 4a 46 49 46');
    expect(validateDocumentBuffer(jpeg)).toBe('image/jpeg');
  });

  it('returns detected MIME when it matches declared type', () => {
    const png = hexToBuffer('89 50 4e 47 0d 0a 1a 0a 00 00');
    expect(validateDocumentBuffer(png, 'image/png')).toBe('image/png');
  });

  it('throws when declared MIME differs from detected MIME', () => {
    const jpeg = hexToBuffer('ff d8 ff e0 00 10 4a 46 49 46');
    expect(() => validateDocumentBuffer(jpeg, 'image/png')).toThrow(DocumentValidationError);
    expect(() => validateDocumentBuffer(jpeg, 'image/png')).toThrow(/does not match/);
  });
});

describe('matchesMimeSignature', () => {
  it('returns false for null/non-Buffer input', () => {
    expect(matchesMimeSignature(null, 'image/jpeg')).toBe(false);
    expect(matchesMimeSignature(undefined, 'image/jpeg')).toBe(false);
    expect(matchesMimeSignature({}, 'image/jpeg')).toBe(false);
  });

  it('returns false for buffer shorter than 4 bytes', () => {
    const short = hexToBuffer('ff d8');
    expect(matchesMimeSignature(short, 'image/jpeg')).toBe(false);
  });

  it('returns true for matching JPEG signature', () => {
    const jpeg = hexToBuffer('ff d8 ff e0 00 10 4a 46 49 46');
    expect(matchesMimeSignature(jpeg, 'image/jpeg')).toBe(true);
  });

  it('returns false for mismatching JPEG signature', () => {
    const png = hexToBuffer('89 50 4e 47 0d 0a 1a 0a 00 00');
    expect(matchesMimeSignature(png, 'image/jpeg')).toBe(false);
  });

  it('returns true for matching PNG signature', () => {
    const png = hexToBuffer('89 50 4e 47 0d 0a 1a 0a 00 00');
    expect(matchesMimeSignature(png, 'image/png')).toBe(true);
  });

  it('returns true for matching PDF signature', () => {
    const pdf = hexToBuffer('25 50 44 46 2d 31 2e 34 0a');
    expect(matchesMimeSignature(pdf, 'application/pdf')).toBe(true);
  });

  it('returns true for unknown mime type (no-op guard)', () => {
    const data = hexToBuffer('01 02 03 04 05 06 07 08');
    expect(matchesMimeSignature(data, 'application/zip')).toBe(true);
  });
});
