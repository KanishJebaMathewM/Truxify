## Problem

`validateImageFile()` in `backend/api/src/lib/ocrProcessor.js` checks `file.size` for the 10 MB maximum and the 1 KB minimum. `size` can be omitted, negative, or forged by a caller constructing a file object directly. An oversized buffer with a small claimed size reaches OCR, and a missing buffer can reach the extraction step after passing validation.

## Root cause

The validator trusts multipart metadata instead of the bytes. It never asserts that `file.buffer` is a Buffer before measuring, and it does not reject an empty buffer explicitly.

## Impact

- Large images can bypass the OCR size limit and consume memory, CPU, and storage.
- Malformed file objects fail later in Tesseract with an opaque error instead of a clear validation response.
- The same bypass affects any internal caller that builds the file object from a stream or test fixture.

## Proposed fix

- Require `file.buffer` to be a Buffer and reject missing content.
- Measure `file.buffer.length` for both the maximum and minimum checks.
- Keep the MIME allowlist and existing error messages for genuine size failures.

## Verification

- Test an oversized buffer with a forged small `file.size` and assert rejection.
- Test a missing buffer and a buffer below 1 KB.
- Test a valid buffer above 1 KB and assert acceptance.

Request: @Senthil455 please assign this issue.
