# Audio Upload Validation

Voice AI uploads are validated by inspecting the actual file bytes (magic
bytes), not the client-declared MIME type, which is trivially spoofable.

## Supported formats

| Container | Signature                        |
| --------- | -------------------------------- |
| WAV       | `RIFF` + `WAVE` at offset 8      |
| MP3       | `ID3` tag, or MPEG frame sync    |
| M4A / MP4 | `ftyp` box at offset 4           |
| AAC       | ADTS frame sync (`0xFF 0xF1/0xF9`) |
| OGG       | `OggS`                           |
| WebM      | EBML header `0x1A 0x45 0xDF 0xA3` |

## API

```js
import { detectAudioMimeType, validateAudioBuffer } from '../lib/audioValidation.js';

// Returns the detected MIME type or null.
const mime = detectAudioMimeType(buffer);

// Throws AudioValidationError for unsupported content.
const verified = validateAudioBuffer(buffer);
```

The declared MIME type is deliberately not required to match the detected
type: mobile recorders label the same container inconsistently
(`audio/wav` vs `audio/x-wav`, `audio/mp4` vs `audio/aac`). Content is the
authority; the declared type is advisory only.

## Rejection

- Empty or non-Buffer input.
- Content that matches no supported container (including RIFF containers
  that are not WAVE, e.g. AVI).
