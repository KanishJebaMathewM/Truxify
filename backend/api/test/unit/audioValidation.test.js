/**
 * Coverage for magic-byte audio validation on the Voice AI upload path.
 *
 * The endpoint previously accepted any file type up to 10MB — no fileFilter,
 * no content inspection — and handed the raw buffer to the speech pipeline.
 */
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_AUDIO_MIME_TYPES,
  AudioValidationError,
  detectAudioMimeType,
  validateAudioBuffer,
} from '../../src/lib/audioValidation.js';

/** Build a buffer from leading bytes, padded so length checks pass. */
function withHeader(bytes, totalLength = 64) {
  const buf = Buffer.alloc(totalLength);
  Buffer.from(bytes).copy(buf, 0);
  return buf;
}

const WAV = (() => {
  const buf = Buffer.alloc(64);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(56, 4);
  buf.write('WAVE', 8, 'ascii');
  return buf;
})();

const M4A = (() => {
  const buf = Buffer.alloc(64);
  buf.writeUInt32BE(32, 0); // box length
  buf.write('ftyp', 4, 'ascii');
  buf.write('M4A ', 8, 'ascii');
  return buf;
})();

const OGG = withHeader([0x4f, 0x67, 0x67, 0x53]);
const WEBM = withHeader([0x1a, 0x45, 0xdf, 0xa3]);
const MP3_ID3 = withHeader([0x49, 0x44, 0x33, 0x04, 0x00]);
const MP3_BARE = withHeader([0xff, 0xfb, 0x90, 0x00]);
const AAC_ADTS = withHeader([0xff, 0xf1, 0x50, 0x80]);

const PNG = withHeader([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF = withHeader([0x25, 0x50, 0x44, 0x46]);
const ELF = withHeader([0x7f, 0x45, 0x4c, 0x46]);
const ZIP = withHeader([0x50, 0x4b, 0x03, 0x04]);

describe('detectAudioMimeType', () => {
  it('detects a RIFF/WAVE container', () => {
    expect(detectAudioMimeType(WAV)).toBe('audio/wav');
  });

  it('detects an ISO base media container at offset 4', () => {
    expect(detectAudioMimeType(M4A)).toBe('audio/mp4');
  });

  it('detects an Ogg container', () => {
    expect(detectAudioMimeType(OGG)).toBe('audio/ogg');
  });

  it('detects an EBML/WebM container', () => {
    expect(detectAudioMimeType(WEBM)).toBe('audio/webm');
  });

  it('detects MP3 with an ID3v2 tag', () => {
    expect(detectAudioMimeType(MP3_ID3)).toBe('audio/mpeg');
  });

  it('detects a bare MP3 via frame sync', () => {
    expect(detectAudioMimeType(MP3_BARE)).toBe('audio/mpeg');
  });

  it('detects ADTS AAC ahead of the generic frame-sync fallback', () => {
    // Both start with 0xFF; the more specific AAC signature must win.
    expect(detectAudioMimeType(AAC_ADTS)).toBe('audio/aac');
  });

  it('rejects a RIFF container that is not WAVE', () => {
    const avi = Buffer.alloc(64);
    avi.write('RIFF', 0, 'ascii');
    avi.write('AVI ', 8, 'ascii');
    expect(detectAudioMimeType(avi)).toBeNull();
  });

  it('rejects image, document, archive and executable content', () => {
    expect(detectAudioMimeType(PNG)).toBeNull();
    expect(detectAudioMimeType(PDF)).toBeNull();
    expect(detectAudioMimeType(ZIP)).toBeNull();
    expect(detectAudioMimeType(ELF)).toBeNull();
  });

  it('returns null for an empty buffer', () => {
    expect(detectAudioMimeType(Buffer.alloc(0))).toBeNull();
  });

  it('returns null for a non-buffer input', () => {
    expect(detectAudioMimeType(null)).toBeNull();
    expect(detectAudioMimeType(undefined)).toBeNull();
    expect(detectAudioMimeType('RIFF....WAVE')).toBeNull();
  });

  it('returns null for a truncated header rather than reading out of bounds', () => {
    expect(detectAudioMimeType(Buffer.from([0x52, 0x49]))).toBeNull();
    // "RIFF" present but truncated before the WAVE marker.
    expect(detectAudioMimeType(Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00]))).toBeNull();
    // ISO box length present but truncated before "ftyp".
    expect(detectAudioMimeType(Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66]))).toBeNull();
  });
});

describe('validateAudioBuffer', () => {
  it('returns the detected type for every supported container', () => {
    expect(validateAudioBuffer(WAV)).toBe('audio/wav');
    expect(validateAudioBuffer(M4A)).toBe('audio/mp4');
    expect(validateAudioBuffer(OGG)).toBe('audio/ogg');
    expect(validateAudioBuffer(WEBM)).toBe('audio/webm');
    expect(validateAudioBuffer(MP3_ID3)).toBe('audio/mpeg');
    expect(validateAudioBuffer(AAC_ADTS)).toBe('audio/aac');
  });

  it('throws AudioValidationError for non-audio content', () => {
    expect(() => validateAudioBuffer(PNG)).toThrow(AudioValidationError);
    expect(() => validateAudioBuffer(ELF)).toThrow(AudioValidationError);
  });

  it('throws for an empty buffer', () => {
    expect(() => validateAudioBuffer(Buffer.alloc(0))).toThrow(AudioValidationError);
  });

  it('throws for a null or non-buffer input', () => {
    expect(() => validateAudioBuffer(null)).toThrow(AudioValidationError);
    expect(() => validateAudioBuffer('not a buffer')).toThrow(AudioValidationError);
  });

  it('rejects a polyglot whose extension disagrees with its content', () => {
    // A PNG renamed voice.wav: the declared type is never consulted, so the
    // content decides and the upload is refused.
    expect(() => validateAudioBuffer(PNG)).toThrow(/Invalid audio type/);
  });

  it('reports a safe message that does not echo file content', () => {
    try {
      validateAudioBuffer(ELF);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AudioValidationError);
      expect(err.message).toMatch(/Only WAV, MP3, M4A\/AAC, OGG and WebM/);
    }
  });

  it('only ever returns a type from the allowlist', () => {
    for (const buffer of [WAV, M4A, OGG, WEBM, MP3_ID3, MP3_BARE, AAC_ADTS]) {
      expect(ALLOWED_AUDIO_MIME_TYPES).toContain(validateAudioBuffer(buffer));
    }
  });
});
