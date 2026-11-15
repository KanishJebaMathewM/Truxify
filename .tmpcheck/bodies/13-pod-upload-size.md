## Problem

`validatePodFile()` in `backend/api/src/lib/storage/podStorage.js` trusts `file.size` for the proof-of-delivery size limit. A caller can construct a file object without a size, or with a small claimed size and a much larger buffer. Both cases pass validation even though the bytes sent to storage exceed the configured maximum.

## Root cause

The multipart parser normally supplies `size`, but the validator is a public helper and storage callers can provide their own file objects. The check also never verifies that the buffer itself exists before measuring it.

## Impact

- Oversized signatures or photos can be uploaded despite the 2 MB and 5 MB limits, consuming storage and bandwidth.
- A missing buffer can reach storage code after validation and fail later with a less useful error.
- The same object-shape weakness makes the limit easy to bypass in tests and internal callers.

## Proposed fix

- Require a Buffer before validating type or size.
- Measure `file.buffer.length` instead of `file.size` and reject empty buffers.
- Keep the MIME allowlist and existing type-specific maximums.

## Verification

- Test a buffer above each type's maximum with a forged small `file.size` and assert rejection.
- Test a missing buffer, an empty buffer, and valid signature/photo buffers.
- Run the proof-of-delivery storage tests.

Request: @Senthil455 please assign this issue.
