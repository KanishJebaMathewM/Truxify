## Problem

`validateImageFile()` in `backend/api/src/lib/ocrProcessor.js` checks `file.size` for the 10 MB maximum and the 1 KB minimum. `size` can be omitted, negative, or forged by a caller constructing a file object directly. An oversized buffer with a small claimed size reaches OCR, and a missing buffer can reach the extraction step after passing validation.

## Change

- Require `file.buffer` to be a Buffer and reject missing content.
- Measure `file.buffer.length` for both the maximum and minimum checks.
- Keep the MIME allowlist and existing error messages for genuine size failures.

## Verification

- Test an oversized buffer with a forged small `file.size` and assert rejection.
- Test a missing buffer and a buffer below 1 KB.
- Test a valid buffer above 1 KB and assert acceptance.

Closes #19482
