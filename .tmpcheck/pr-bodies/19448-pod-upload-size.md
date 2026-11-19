## Problem

`validatePodFile()` in `backend/api/src/lib/storage/podStorage.js` trusts `file.size` for the proof-of-delivery size limit. A caller can construct a file object without a size, or with a small claimed size and a much larger buffer. Both cases pass validation even though the bytes sent to storage exceed the configured maximum.

## Change

- Require a Buffer before validating type or size.
- Measure `file.buffer.length` instead of `file.size` and reject empty buffers.
- Keep the MIME allowlist and existing type-specific maximums.

## Verification

- Test a buffer above each type's maximum with a forged small `file.size` and assert rejection.
- Test a missing buffer, an empty buffer, and valid signature/photo buffers.
- Run the proof-of-delivery storage tests.

Closes #19448
