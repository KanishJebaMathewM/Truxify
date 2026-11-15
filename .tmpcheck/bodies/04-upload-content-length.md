## Problem

`checkContentLength()` in `backend/api/src/lib/uploadFilename.js` passes the raw `Content-Length` header through `Number()`. That coercion accepts fractions (`1.5`), exponent notation (`1e9`), hexadecimal (`0x10`), and whitespace that Node's HTTP parser does not treat as a valid length. The function can therefore approve a request whose real body size is interpreted differently downstream.

## Root cause

The validator checks only whether the coerced result is a safe integer. It does not validate the HTTP grammar first, and it does not validate the configured maximum. A caller can also pass a zero or negative `maxBytes`, which makes every positive body exceed the limit while allowing a zero-length body through.

## Impact

- Upload size limits can be bypassed or misapplied when proxies, Node, and this helper disagree about the header value.
- A malformed header can reach downstream parsers that interpret it differently, creating request-boundary ambiguity.
- An invalid configured limit turns a boundary check into an unpredictable rejection or acceptance path.

## Proposed fix

- Require the raw header to be a string matching `^[0-9]+$` before conversion.
- Require the parsed length and configured maximum to be safe, positive integers.
- Return the existing typed 400/411/413 errors for each failure path.

## Verification

- Test `1.5`, `1e9`, `0x10`, `+10`, ` 10`, and values above `Number.MAX_SAFE_INTEGER` and assert a 400.
- Test a valid length at, below, and above the maximum.
- Test a zero or negative `maxBytes` and assert an internal configuration error.

Request: @Senthil455 please assign this issue.
