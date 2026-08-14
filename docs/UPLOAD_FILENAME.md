# Upload Filename Sanitization

## Overview

The Truxify backend sanitizes every client-supplied upload filename before it reaches log lines, storage keys, or downstream services. The sanitizer (`lib/uploadFilename.js`) is shared by the document, maintenance-photo, and voice upload paths.

---

## Location

```
backend/api/src/lib/uploadFilename.js
```

---

## Behavior

`sanitizeUploadFilename(originalName, fallback)` guarantees the result:

- Contains **no path separators** (`/` or `\`) — directory components are stripped on any platform.
- Contains **no traversal sequences**, shell metacharacters, control characters, or NUL bytes — anything outside `[A-Za-z0-9._-]` is collapsed to `_`.
- Is never a hidden file — leading dots are removed.
- Is never empty — falls back to the provided fallback name (`upload` by default).
- Is at most 120 characters, preserving the extension when truncated.
- Is not a Windows reserved device name (`con`, `prn`, `aux`, `nul`, `com1`...`com9`, `lpt1`...`lpt9`).

---

## Examples

| Input | Result |
|-------|--------|
| `../../etc/passwd` | `passwd` |
| `..\\..\\windows\\system32\\config` | `config` |
| `audio\x00.wav` | `audio.wav` |
| `audio;rm -rf ~.wav` | `audio_rm_-rf_.wav` |
| `.hidden.wav` | `hidden.wav` |
| `(empty)` | `upload` |

---

## Why It Exists

`file.originalname` is entirely client-controlled. Unsanitized, it can reach log lines (log injection), storage keys (path traversal), and downstream service calls (shell injection). Normalizing it once, in one shared helper, keeps every upload path safe.

---

## Testing

Automated tests verify:

- Directory components are stripped on POSIX and Windows styles.
- Control characters and NUL bytes are removed.
- Shell metacharacters are neutralized.
- Long names are truncated with the extension preserved.
- Reserved names and empty input fall back safely.
