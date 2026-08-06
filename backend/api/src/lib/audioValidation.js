/**
 * Server-side audio content validation for Voice AI uploads.
 *
 * The client (Flutter app) can only tell us the declared MIME type and the
 * filename the recorder produced, both of which are trivially spoofable.
 * This module inspects the first bytes of the actual file content ("magic
 * bytes") to determine the real container format, independent of anything
 * the client claims.
 *
 * Mirrors the structure of documentValidation.js, which does the same job
 * for driver KYC document uploads.
 */

export const ALLOWED_AUDIO_MIME_TYPES = Object.freeze([
  'audio/wav',
  'audio/x-wav',
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/ogg',
  'audio/webm',
]);

/**
 * Container signatures.
 *
 * `offset` is where the bytes begin. ISO-BMFF containers (m4a/mp4) carry
 * their `ftyp` box at offset 4, after the box length.
 */
const SIGNATURES = [
  // "RIFF" .... "WAVE" — the WAVE marker is checked separately at offset 8.
  { mime: 'audio/wav', offset: 0, bytes: [0x52, 0x49, 0x46, 0x46], riffWave: true },
  // "OggS"
  { mime: 'audio/ogg', offset: 0, bytes: [0x4f, 0x67, 0x67, 0x53] },
  // EBML header — WebM and Matroska
  { mime: 'audio/webm', offset: 0, bytes: [0x1a, 0x45, 0xdf, 0xa3] },
  // "ftyp" at offset 4 — ISO base media (M4A / MP4 audio)
  { mime: 'audio/mp4', offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] },
  // "ID3" — MP3 with an ID3v2 tag
  { mime: 'audio/mpeg', offset: 0, bytes: [0x49, 0x44, 0x33] },
  // ADTS AAC frame sync
  { mime: 'audio/aac', offset: 0, bytes: [0xff, 0xf1] },
  { mime: 'audio/aac', offset: 0, bytes: [0xff, 0xf9] },
];

/** "WAVE" — appears at offset 8 in a RIFF/WAVE container. */
const WAVE_MARKER = [0x57, 0x41, 0x56, 0x45];

/** MPEG audio frame sync: 11 set bits. Matches a bare MP3 with no ID3 tag. */
function isMpegFrameSync(buffer) {
  if (buffer.length < 2) return false;
  return buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0;
}

function matchesAt(buffer, bytes, offset) {
  if (buffer.length < offset + bytes.length) {
    return false;
  }
  for (let i = 0; i < bytes.length; i += 1) {
    if (buffer[offset + i] !== bytes[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Detects the real MIME type of an audio buffer by inspecting its magic
 * bytes. Returns null if the content does not match any allowed audio
 * container, regardless of the extension or Content-Type the client supplied.
 *
 * @param {Buffer} buffer
 * @returns {string|null}
 */
export function detectAudioMimeType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return null;
  }

  for (const signature of SIGNATURES) {
    if (!matchesAt(buffer, signature.bytes, signature.offset)) {
      continue;
    }
    // A RIFF container can hold formats other than WAVE (e.g. AVI), so the
    // WAVE marker is required before it is accepted as audio.
    if (signature.riffWave && !matchesAt(buffer, WAVE_MARKER, 8)) {
      continue;
    }
    return signature.mime;
  }

  // Bare MP3 with no ID3 tag. Checked last so ADTS AAC, which shares the
  // 0xFF lead byte, is matched by its more specific signature first.
  if (isMpegFrameSync(buffer)) {
    return 'audio/mpeg';
  }

  return null;
}

/**
 * Validates that an audio upload's real content matches an allowed container.
 *
 * The declared MIME type is deliberately *not* required to match the detected
 * type: mobile recorders label the same container inconsistently (`audio/wav`
 * vs `audio/x-wav`, `audio/mp4` vs `audio/aac`). Content is the authority;
 * the declared type is advisory only.
 *
 * @param {Buffer} buffer
 * @returns {string} The verified MIME type.
 * @throws {AudioValidationError} When the content is not a supported audio type.
 */
export function validateAudioBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new AudioValidationError('Audio file is empty or unreadable.');
  }

  const detected = detectAudioMimeType(buffer);

  if (!detected || !ALLOWED_AUDIO_MIME_TYPES.includes(detected)) {
    throw new AudioValidationError(
      `Invalid audio type: ${detected ?? 'unknown'}. Only WAV, MP3, M4A/AAC, OGG and WebM audio are accepted.`
    );
  }

  return detected;
}

export class AudioValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AudioValidationError';
  }
}
