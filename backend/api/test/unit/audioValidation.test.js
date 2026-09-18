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

/**
 * Unit Tests for audioValidation.js
 * 
 * Tests magic-byte inspection, valid/invalid format detection,
 * truncated headers, oversized payloads, and error handling.
 */
import { describe, it, expect } from 'vitest';
import { 
  detectAudioMimeType, 
  validateAudioBuffer, 
  AudioValidationError,
  ALLOWED_AUDIO_MIME_TYPES 
} from '../../src/lib/audioValidation.js';
import {
  createValidWavBuffer,
  createValidMp3Id3Buffer,
  createValidBareMp3Buffer,
  createValidM4aBuffer,
  createValidOggBuffer,
  createValidWebmBuffer,
  createValidAacBuffer,
  createInvalidRiffBuffer,
  createInvalidGarbageBuffer,
  createTruncatedBuffer,
  createOversizedBuffer,
} from '../fixtures/audioValidationFixtures.js';

describe('audioValidation', () => {
  describe('ALLOWED_AUDIO_MIME_TYPES', () => {
    it('should be a frozen array of expected MIME types', () => {
      expect(ALLOWED_AUDIO_MIME_TYPES).toBeInstanceOf(Array);
      expect(Object.isFrozen(ALLOWED_AUDIO_MIME_TYPES)).toBe(true);
      expect(ALLOWED_AUDIO_MIME_TYPES).toContain('audio/wav');
      expect(ALLOWED_AUDIO_MIME_TYPES).toContain('audio/mpeg');
      expect(ALLOWED_AUDIO_MIME_TYPES).toContain('audio/mp4');
      expect(ALLOWED_AUDIO_MIME_TYPES).toContain('audio/ogg');
      expect(ALLOWED_AUDIO_MIME_TYPES).toContain('audio/webm');
      expect(ALLOWED_AUDIO_MIME_TYPES).toContain('audio/aac');
    });
  });

  describe('detectAudioMimeType', () => {
    it('should return null for null or undefined input', () => {
      expect(detectAudioMimeType(null)).toBeNull();
      expect(detectAudioMimeType(undefined)).toBeNull();
    });

    it('should return null for non-Buffer input', () => {
      expect(detectAudioMimeType('string')).toBeNull();
      expect(detectAudioMimeType({})).toBeNull();
      expect(detectAudioMimeType(123)).toBeNull();
    });

    it('should return null for empty buffer', () => {
      expect(detectAudioMimeType(Buffer.alloc(0))).toBeNull();
    });

    it('should detect valid WAV buffer', () => {
      const buffer = createValidWavBuffer();
      expect(detectAudioMimeType(buffer)).toBe('audio/wav');
    });

    it('should detect valid MP3 buffer with ID3 tag', () => {
      const buffer = createValidMp3Id3Buffer();
      expect(detectAudioMimeType(buffer)).toBe('audio/mpeg');
    });

    it('should detect valid bare MP3 buffer without ID3 tag', () => {
      const buffer = createValidBareMp3Buffer();
      expect(detectAudioMimeType(buffer)).toBe('audio/mpeg');
    });

    it('should detect valid M4A/MP4 buffer', () => {
      const buffer = createValidM4aBuffer();
      expect(detectAudioMimeType(buffer)).toBe('audio/mp4');
    });

    it('should detect valid OGG buffer', () => {
      const buffer = createValidOggBuffer();
      expect(detectAudioMimeType(buffer)).toBe('audio/ogg');
    });

    it('should detect valid WebM buffer', () => {
      const buffer = createValidWebmBuffer();
      expect(detectAudioMimeType(buffer)).toBe('audio/webm');
    });

    it('should detect valid AAC buffer', () => {
      const buffer = createValidAacBuffer();
      expect(detectAudioMimeType(buffer)).toBe('audio/aac');
    });

    it('should reject invalid RIFF container (e.g., AVI)', () => {
      const buffer = createInvalidRiffBuffer();
      expect(detectAudioMimeType(buffer)).toBeNull();
    });

    it('should reject garbage bytes', () => {
      const buffer = createInvalidGarbageBuffer();
      expect(detectAudioMimeType(buffer)).toBeNull();
    });

    it('should handle truncated buffers gracefully', () => {
      const buffer = createTruncatedBuffer();
      expect(detectAudioMimeType(buffer)).toBeNull();
    });

    it('should handle oversized buffers efficiently', () => {
      const buffer = createOversizedBuffer();
      // Should not throw or hang, and should detect the valid header
      expect(detectAudioMimeType(buffer)).toBe('audio/ogg');
    });
  });

  describe('validateAudioBuffer', () => {
    it('should throw AudioValidationError for null input', () => {
      expect(() => validateAudioBuffer(null)).toThrow(AudioValidationError);
      expect(() => validateAudioBuffer(null)).toThrow('Audio file is empty or unreadable.');
    });

    it('should throw AudioValidationError for empty buffer', () => {
      expect(() => validateAudioBuffer(Buffer.alloc(0))).toThrow(AudioValidationError);
      expect(() => validateAudioBuffer(Buffer.alloc(0))).toThrow('Audio file is empty or unreadable.');
    });

    it('should throw AudioValidationError for invalid audio type', () => {
      const buffer = createInvalidGarbageBuffer();
      expect(() => validateAudioBuffer(buffer)).toThrow(AudioValidationError);
      expect(() => validateAudioBuffer(buffer)).toThrow('Invalid audio type: unknown.');
    });

    it('should return verified MIME type for valid WAV', () => {
      const buffer = createValidWavBuffer();
      expect(validateAudioBuffer(buffer)).toBe('audio/wav');
    });

    it('should return verified MIME type for valid MP3', () => {
      const buffer = createValidBareMp3Buffer();
      expect(validateAudioBuffer(buffer)).toBe('audio/mpeg');
    });

    it('should return verified MIME type for valid M4A', () => {
      const buffer = createValidM4aBuffer();
      expect(validateAudioBuffer(buffer)).toBe('audio/mp4');
    });

    it('should return verified MIME type for valid OGG', () => {
      const buffer = createValidOggBuffer();
      expect(validateAudioBuffer(buffer)).toBe('audio/ogg');
    });

    it('should return verified MIME type for valid WebM', () => {
      const buffer = createValidWebmBuffer();
      expect(validateAudioBuffer(buffer)).toBe('audio/webm');
    });

    it('should return verified MIME type for valid AAC', () => {
      const buffer = createValidAacBuffer();
      expect(validateAudioBuffer(buffer)).toBe('audio/aac');
    });
  });

  describe('AudioValidationError', () => {
    it('should be an instance of Error', () => {
      const error = new AudioValidationError('Test message');
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('AudioValidationError');
      expect(error.message).toBe('Test message');
    });
  });
});
