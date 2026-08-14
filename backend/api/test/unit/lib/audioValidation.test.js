import { describe, it, expect } from 'vitest';
import {
  detectAudioMimeType,
  validateAudioBuffer,
  AudioValidationError,
  ALLOWED_AUDIO_MIME_TYPES,
} from '../../../src/lib/audioValidation.js';

function hexToBuffer(hexString) {
  const bytes = hexString.replace(/\s+/g, '').match(/.{2}/g).map(b => parseInt(b, 16));
  return Buffer.from(bytes);
}

describe('detectAudioMimeType', () => {
  it('returns null for null/undefined input', () => {
    expect(detectAudioMimeType(null)).toBeNull();
    expect(detectAudioMimeType(undefined)).toBeNull();
  });

  it('returns null for non-Buffer input', () => {
    expect(detectAudioMimeType('string')).toBeNull();
    expect(detectAudioMimeType({})).toBeNull();
    expect(detectAudioMimeType(Buffer.alloc(0))).toBeNull();
  });

  it('detects WAV from RIFF+WAVE magic bytes', () => {
    // RIFF header + WAVE format at offset 8
    const wav = hexToBuffer('52 49 46 46 24 00 00 00 57 41 56 45');
    expect(detectAudioMimeType(wav)).toBe('audio/wav');
  });

  it('detects OGG from magic bytes', () => {
    const ogg = hexToBuffer('4f 67 67 53 00 02 00 00 00 00 00 00');
    expect(detectAudioMimeType(ogg)).toBe('audio/ogg');
  });

  it('detects WebM from EBML header', () => {
    const webm = hexToBuffer('1a 45 df a3 9f 84 00 00');
    expect(detectAudioMimeType(webm)).toBe('audio/webm');
  });

  it('detects MP4/M4A from ftyp at offset 4', () => {
    const mp4 = hexToBuffer('00 00 00 18 66 74 79 70 4d 34 41 20');
    expect(detectAudioMimeType(mp4)).toBe('audio/mp4');
  });

  it('detects MP3 with ID3 tag', () => {
    const mp3 = hexToBuffer('49 44 33 04 00 00 00 00 00 00');
    expect(detectAudioMimeType(mp3)).toBe('audio/mpeg');
  });

  it('detects AAC from ADTS frame sync', () => {
    const aac = hexToBuffer('ff f1 50 80 00 00 00 00');
    expect(detectAudioMimeType(aac)).toBe('audio/aac');
  });

  it('detects bare MP3 from MPEG frame sync', () => {
    // 0xFF 0xE3 = frame sync with MPEG audio version 1, layer 3
    const bareMp3 = hexToBuffer('ff e3 00 00 00 00 00 00');
    expect(detectAudioMimeType(bareMp3)).toBe('audio/mpeg');
  });

  it('returns null for unknown magic bytes', () => {
    const unknown = hexToBuffer('01 02 03 04 05 06 07 08 09 0a 0b 0c');
    expect(detectAudioMimeType(unknown)).toBeNull();
  });

  it('rejects RIFF file without WAVE marker', () => {
    // RIFF with AVI format (not WAVE)
    const avi = hexToBuffer('52 49 46 46 24 00 00 00 41 56 49 20');
    expect(detectAudioMimeType(avi)).toBeNull();
  });
});

describe('validateAudioBuffer', () => {
  it('throws AudioValidationError for null/non-Buffer input', () => {
    expect(() => validateAudioBuffer(null)).toThrow(AudioValidationError);
    expect(() => validateAudioBuffer(Buffer.alloc(0))).toThrow(AudioValidationError);
  });

  it('throws for disallowed audio types', () => {
    // MIDI header
    const midi = hexToBuffer('4d 54 68 64 00 00 00 06 00 01');
    expect(() => validateAudioBuffer(midi)).toThrow(AudioValidationError);
  });

  it('returns detected MIME for allowed audio', () => {
    const ogg = hexToBuffer('4f 67 67 53 00 02 00 00 00 00 00 00');
    expect(validateAudioBuffer(ogg)).toBe('audio/ogg');
  });

  it('does not require declared MIME to match detected', () => {
    // The function ignores declaredMimeType - content is the authority
    const mp4 = hexToBuffer('00 00 00 18 66 74 79 70 4d 34 41 20');
    const result = validateAudioBuffer(mp4);
    expect(result).toBe('audio/mp4');
  });
});

describe('AudioValidationError', () => {
  it('extends Error', () => {
    const err = new AudioValidationError('test');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('AudioValidationError');
  });

  it('sets message', () => {
    const err = new AudioValidationError('Invalid audio');
    expect(err.message).toBe('Invalid audio');
  });
});

describe('ALLOWED_AUDIO_MIME_TYPES', () => {
  it('includes expected audio formats', () => {
    expect(ALLOWED_AUDIO_MIME_TYPES).toContain('audio/wav');
    expect(ALLOWED_AUDIO_MIME_TYPES).toContain('audio/mpeg');
    expect(ALLOWED_AUDIO_MIME_TYPES).toContain('audio/mp4');
    expect(ALLOWED_AUDIO_MIME_TYPES).toContain('audio/aac');
    expect(ALLOWED_AUDIO_MIME_TYPES).toContain('audio/ogg');
    expect(ALLOWED_AUDIO_MIME_TYPES).toContain('audio/webm');
  });
});
