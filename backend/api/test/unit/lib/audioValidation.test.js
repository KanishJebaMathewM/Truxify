/**
 * Unit tests for backend/api/src/lib/audioValidation.js
 *
 * Coverage:
 *   - detectAudioMimeType: valid audio signatures (WAV, MP3, OGG, WebM, M4A, AAC)
 *   - detectAudioMimeType: invalid/empty buffer returns null
 *   - validateAudioBuffer: accepts valid audio
 *   - validateAudioBuffer: rejects empty buffer
 *   - validateAudioBuffer: rejects unsupported type
 *   - AudioValidationError: has correct name and message
 *
 * Run with:  npm run test:unit -- --reporter=default
 */
import { describe, it, expect } from 'vitest'
import {
  detectAudioMimeType,
  validateAudioBuffer,
  AudioValidationError,
  ALLOWED_AUDIO_MIME_TYPES,
} from '../../../src/lib/audioValidation.js'

function hexToBuffer(hex) {
  const clean = hex.replace(/\s/g, '')
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.substring(i, i + 2), 16)
  }
  return Buffer.from(bytes)
}

describe('audioValidation — detectAudioMimeType', () => {
  it('returns audio/wav for RIFF/WAVE header', () => {
    // RIFF....WAVE
    const buf = hexToBuffer('52494646 00000000 57415645')
    expect(detectAudioMimeType(buf)).toBe('audio/wav')
  })

  it('returns audio/mpeg for MP3 with ID3 tag', () => {
    // ID3
    const buf = hexToBuffer('49443303 00000000')
    expect(detectAudioMimeType(buf)).toBe('audio/mpeg')
  })

  it('returns audio/mpeg for bare MP3 frame sync (no ID3)', () => {
    // 0xFF 0xFB = MPEG audio frame sync
    const buf = hexToBuffer('FF FB 90 00')
    expect(detectAudioMimeType(buf)).toBe('audio/mpeg')
  })

  it('returns audio/ogg for OggS header', () => {
    const buf = hexToBuffer('4F676753 00000002')
    expect(detectAudioMimeType(buf)).toBe('audio/ogg')
  })

  it('returns audio/webm for EBML header', () => {
    const buf = hexToBuffer('1A45DFA3 9F')
    expect(detectAudioMimeType(buf)).toBe('audio/webm')
  })

  it('returns audio/mp4 for ISO base media ftyp box', () => {
    // ftyp box at offset 4 (after 4-byte box length)
    // 4 dummy bytes + ftyp (4 bytes) + brand (4 bytes) = 12 bytes
    const buf = hexToBuffer('00000008 66747970 4D344120')
    expect(detectAudioMimeType(buf)).toBe('audio/mp4')
  })

  it('returns audio/aac for ADTS frame sync 0xFF 0xF1', () => {
    const buf = hexToBuffer('FFF1 9000')
    expect(detectAudioMimeType(buf)).toBe('audio/aac')
  })

  it('returns audio/aac for ADTS frame sync 0xFF 0xF9', () => {
    const buf = hexToBuffer('FFF9 9000')
    expect(detectAudioMimeType(buf)).toBe('audio/aac')
  })

  it('returns null for empty buffer', () => {
    expect(detectAudioMimeType(Buffer.alloc(0))).toBeNull()
    expect(detectAudioMimeType(null)).toBeNull()
  })

  it('returns null for non-buffer input', () => {
    expect(detectAudioMimeType('not a buffer')).toBeNull()
    expect(detectAudioMimeType({})).toBeNull()
    expect(detectAudioMimeType(undefined)).toBeNull()
  })

  it('returns null for unrecognized magic bytes', () => {
    // PNG header
    const buf = hexToBuffer('89504E47 0D0A1A0A')
    expect(detectAudioMimeType(buf)).toBeNull()
  })

  it('returns null for RIFF/WAVE without WAVE marker (e.g. AVI)', () => {
    // RIFF but not WAVE at offset 8
    const buf = hexToBuffer('52494646 00000000 41564920')
    expect(detectAudioMimeType(buf)).toBeNull()
  })
})

describe('audioValidation — validateAudioBuffer', () => {
  it('returns the detected mime type for valid WAV', () => {
    const buf = hexToBuffer('52494646 00000000 57415645')
    expect(validateAudioBuffer(buf)).toBe('audio/wav')
  })

  it('returns the detected mime type for valid MP3', () => {
    const buf = hexToBuffer('FF FB 90 00')
    expect(validateAudioBuffer(buf)).toBe('audio/mpeg')
  })

  it('throws AudioValidationError for empty buffer', () => {
    expect(() => validateAudioBuffer(Buffer.alloc(0))).toThrow(AudioValidationError)
    expect(() => validateAudioBuffer(Buffer.alloc(0))).toThrow('empty or unreadable')
  })

  it('throws AudioValidationError for non-audio content', () => {
    // PNG header
    const buf = hexToBuffer('89504E47 0D0A1A0A')
    expect(() => validateAudioBuffer(buf)).toThrow(AudioValidationError)
    expect(() => validateAudioBuffer(buf)).toThrow('Invalid audio type')
  })

  it('throws AudioValidationError for null input', () => {
    expect(() => validateAudioBuffer(null)).toThrow(AudioValidationError)
    expect(() => validateAudioBuffer(null)).toThrow('empty or unreadable')
  })
})

describe('audioValidation — AudioValidationError', () => {
  it('has name AudioValidationError', () => {
    const err = new AudioValidationError('test message')
    expect(err.name).toBe('AudioValidationError')
  })

  it('has the correct message', () => {
    const err = new AudioValidationError('custom message')
    expect(err.message).toBe('custom message')
  })

  it('is an instance of Error', () => {
    expect(new AudioValidationError('x')).toBeInstanceOf(Error)
  })
})

describe('audioValidation — ALLOWED_AUDIO_MIME_TYPES', () => {
  it('includes common audio formats', () => {
    expect(ALLOWED_AUDIO_MIME_TYPES).toContain('audio/wav')
    expect(ALLOWED_AUDIO_MIME_TYPES).toContain('audio/mpeg')
    expect(ALLOWED_AUDIO_MIME_TYPES).toContain('audio/mp4')
    expect(ALLOWED_AUDIO_MIME_TYPES).toContain('audio/aac')
    expect(ALLOWED_AUDIO_MIME_TYPES).toContain('audio/ogg')
    expect(ALLOWED_AUDIO_MIME_TYPES).toContain('audio/webm')
  })

  it('is frozen (immutable)', () => {
    expect(Object.isFrozen(ALLOWED_AUDIO_MIME_TYPES)).toBe(true)
  })
})
