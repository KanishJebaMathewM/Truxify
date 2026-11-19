## Problem

`checkContentLength()` in `backend/api/src/lib/uploadFilename.js` passes the raw `Content-Length` header through `Number()`. That coercion accepts fractions (`1.5`), exponent notation (`1e9`), hexadecimal (`0x10`), and whitespace that Node's HTTP parser does not treat as a valid length. The function can therefore approve a request whose real body size is interpreted differently downstream.

## Change

- Require the raw header to be a string matching `^[0-9]+$` before conversion.
- Require the parsed length and configured maximum to be safe, positive integers.
- Return the existing typed 400/411/413 errors for each failure path.

## Verification

- Test `1.5`, `1e9`, `0x10`, `+10`, ` 10`, and values above `Number.MAX_SAFE_INTEGER` and assert a 400.
- Test a valid length at, below, and above the maximum.
- Test a zero or negative `maxBytes` and assert an internal configuration error.

Closes #19439
