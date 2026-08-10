# Upload Filename Sanitisation

`sanitizeUploadFilename()` normalises client-supplied filenames before they
reach log lines, storage keys, or downstream services.

## Guarantees

- No path separators (`/` or `\`).
- No traversal sequences (`..`).
- No control characters or NUL bytes.
- No leading dots (hidden files).
- Never empty — falls back to the provided fallback name.
- Windows reserved device names (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`,
  `LPT1-9`) are rejected.
- Maximum length 120 characters (extension preserved up to 12 chars).

## Behaviour

1. Strips any directory component (handles both `/` and `\`).
2. Removes control characters.
3. Replaces anything outside `[A-Za-z0-9._-]` with `_`.
4. Collapses repeated dots and strips leading dots.
5. Clamps length, preserving the extension.
6. Rejects reserved names.

## Usage

```js
import { sanitizeUploadFilename } from '../lib/uploadFilename.js';

const safe = sanitizeUploadFilename(req.file.originalname, 'upload');
```

Shared by the document, maintenance-photo, and voice upload paths so the
rules cannot drift between them.
