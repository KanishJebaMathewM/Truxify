## Problem

`headerSizeMonitor` in `backend/api/src/middleware/headerSizeMonitor.js` sums header name and value lengths but omits the `: ` separator, CRLF after each field, the final CRLF, and request-line overhead. A request can exceed the configured header limit by several hundred bytes while the guard reports it as within bounds.

## Root cause

The monitor measures a logical map rather than the bytes on the wire. Node preserves the original header pairs in `rawHeaders`, but the middleware only iterates `req.headers`, and it does not account for values added after the request was parsed.

## Impact

- Header-flood attacks can exceed the configured threshold without triggering the guard.
- Proxies and the origin can disagree about request size, weakening a defense-in-depth limit.
- Middleware-added headers are invisible to the check, so the measured size drifts from the actual response/request state.

## Proposed fix

- Measure `rawHeaders` including the separator and CRLFs when available.
- Also measure the parsed header map, using the larger of the two totals.
- Preserve the configured threshold and existing rejection response.

## Verification

- Construct a request with known header pairs and assert the total includes separators and CRLFs.
- Add a header after parsing and assert the larger parsed total is used.
- Test a request just below and just above the threshold.

Request: @Senthil455 please assign this issue.
