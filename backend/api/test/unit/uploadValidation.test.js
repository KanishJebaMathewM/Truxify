import { describe, expect, it } from 'vitest';
import {
  ALLOWED_DOCUMENT_MIME_TYPES,
  detectDocumentMimeType,
  validateDocumentBuffer,
  DocumentValidationError,
  matchesMimeSignature,
} from '../../src/lib/documentValidation.js';
import {
  ALLOWED_AUDIO_MIME_TYPES,
  detectAudioMimeType,
  validateAudioBuffer,
} from '../../src/lib/audioValidation.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const PDF = Buffer.from('%PDF-1.7 content');
const EXE = Buffer.from([0x4d, 0x5a, 0x90, 0x00]); // MZ executable
const WAV = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45]); // RIFF....WAVE
const AVI = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x41, 0x56, 0x49, 0x20]); // RIFF....AVI
const OGG = Buffer.from([0x4f, 0x67, 0x67, 0x53, 0x00, 0x02]);
const MP4 = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]);
const ID3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]);
const AAC_ADTS = Buffer.from([0xff, 0xf1, 0x50, 0x80]);
const MP3_FRAME = Buffer.from([0xff, 0xfb, 0x90, 0x00]);

describe('documentValidation (magic bytes, upload-spoofing defense)', () => {
  it('detects JPEG/PNG/PDF by content regardless of extension claims', () => {
    expect(detectDocumentMimeType(JPEG)).toBe('image/jpeg');
    expect(detectDocumentMimeType(PNG)).toBe('image/png');
    expect(detectDocumentMimeType(PDF)).toBe('application/pdf');
  });

  it('unknown content (e.g. a renamed EXE) detects as null', () => {
    expect(detectDocumentMimeType(EXE)).toBeNull();
  });

  it('guards null/empty/non-buffer input', () => {
    expect(detectDocumentMimeType(null)).toBeNull();
    expect(detectDocumentMimeType(Buffer.alloc(0))).toBeNull();
    expect(detectDocumentMimeType('not a buffer')).toBeNull();
  });

  it('validateDocumentBuffer passes matching content+declaration', () => {
    expect(validateDocumentBuffer(JPEG, 'image/jpeg')).toBe('image/jpeg');
    expect(validateDocumentBuffer(JPEG, ' image/JPEG ')).toBe('image/jpeg'); // case/space normalized
    expect(validateDocumentBuffer(PDF, null)).toBe('application/pdf'); // declaration optional
  });

  it('rejects content/declaration mismatches (spoofed Content-Type)', () => {
    expect(() => validateDocumentBuffer(EXE, 'image/jpeg')).toThrow(DocumentValidationError);
    expect(() => validateDocumentBuffer(JPEG, 'application/pdf')).toThrow(/does not match declared/);
  });

  it('rejects disallowed real types (GIF is not an accepted document)', () => {
    const GIF = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    expect(() => validateDocumentBuffer(GIF, null)).toThrow(/Only JPEG, PNG, and PDF/);
  });

  it('rejects null/empty buffers with specific errors', () => {
    expect(() => validateDocumentBuffer(null, null)).toThrow(/null or undefined/);
    expect(() => validateDocumentBuffer(Buffer.alloc(0), null)).toThrow(/empty/);
  });

  it('matchesMimeSignature enforces known signatures and passes unknown types through', () => {
    expect(matchesMimeSignature(PNG, 'image/png')).toBe(true);
    expect(matchesMimeSignature(JPEG, 'image/png')).toBe(false);
    expect(matchesMimeSignature(EXE, 'application/octet-stream')).toBe(true); // unknown type: no signature to check
    expect(matchesMimeSignature(null, 'image/png')).toBe(false);
  });

  it('ALLOWED_DOCUMENT_MIME_TYPES is frozen', () => {
    expect(Object.isFrozen(ALLOWED_DOCUMENT_MIME_TYPES)).toBe(true);
  });
});

describe('audioValidation (content is authority; declaration advisory)', () => {
  it('detects WAV (with the WAVE marker), OGG, MP4, ID3-MP3, ADTS AAC, bare MP3 frames', () => {
    expect(detectAudioMimeType(WAV)).toBe('audio/wav');
    expect(detectAudioMimeType(OGG)).toBe('audio/ogg');
    expect(detectAudioMimeType(MP4)).toBe('audio/mp4');
    expect(detectAudioMimeType(ID3)).toBe('audio/mpeg');
    expect(detectAudioMimeType(AAC_ADTS)).toBe('audio/aac');
    expect(detectAudioMimeType(MP3_FRAME)).toBe('audio/mpeg');
  });

  it('RIFF containers without the WAVE marker are NOT audio (AVI video)', () => {
    expect(detectAudioMimeType(AVI)).toBeNull();
  });

  it('guards null/empty/non-buffer', () => {
    expect(detectAudioMimeType(null)).toBeNull();
    expect(detectAudioMimeType(Buffer.alloc(0))).toBeNull();
    expect(detectAudioMimeType('x')).toBeNull();
  });

  it('validateAudioBuffer returns the detected type for allowed audio', () => {
    expect(validateAudioBuffer(WAV)).toBe('audio/wav');
    expect(validateAudioBuffer(MP4)).toBe('audio/mp4');
  });

  it('rejects non-audio content', () => {
    expect(() => validateAudioBuffer(EXE)).toThrow();
    expect(() => validateAudioBuffer(JPEG)).toThrow();
  });

  it('ADTS AAC wins over the bare-MP3 frame fallback (shared 0xFF lead)', () => {
    expect(detectAudioMimeType(AAC_ADTS)).toBe('audio/aac');
  });

  it('ALLOWED_AUDIO_MIME_TYPES is frozen', () => {
    expect(Object.isFrozen(ALLOWED_AUDIO_MIME_TYPES)).toBe(true);
  });
});
