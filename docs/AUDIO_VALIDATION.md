# Audio Content Validation

## Overview

The Truxify backend validates the actual content of voice-upload audio files before they reach the speech pipeline. The validator (`lib/audioValidation.js`) inspects magic bytes to determine the real container format, independent of what the client declares.

---

## Location

```
backend/api/src/lib/audioValidation.js
```

---

## Allowed Formats

| Container | Signature |
|-----------|-----------|
| WAV | `RIFF` + `WAVE` marker |
| MP3 | `ID3` tag, or an MPEG frame sync |
| M4A / MP4 audio | `ftyp` box at offset 4 |
| AAC (ADTS) | frame sync `0xFF F1/F9` |
| OGG | `OggS` |
| WebM / Matroska | EBML header `0x1A 45 DF A3` |

---

## Behavior

- `detectAudioMimeType(buffer)` returns the detected MIME type or `null`.
- `validateAudioBuffer(buffer)` throws `AudioValidationError` for empty, non-buffer, or unsupported content, and returns the verified MIME type on success.
- The declared MIME type is advisory only — the real container is authoritative (mobile recorders label the same container inconsistently).
- A `RIFF` container that is not `WAVE` (e.g. an AVI) is rejected.

---

## Why It Exists

Voice recordings are processed by an external speech pipeline; a malformed or malicious file could waste processing or trigger parser bugs. Magic-byte validation ensures only real audio containers are ever forwarded, regardless of the filename or Content-Type.

---

## Testing

Automated tests verify:

- Every supported container is detected.
- Non-audio content (images, PDFs, executables, archives) is rejected.
- Truncated headers fail safely.
- Polyglot uploads whose content is not audio are refused.
