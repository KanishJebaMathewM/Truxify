## Problem

`headerSizeMonitor` in `backend/api/src/middleware/headerSizeMonitor.js` sums header name and value lengths but omits the `: ` separator, CRLF after each field, the final CRLF, and request-line overhead. A request can exceed the configured header limit by several hundred bytes while the guard reports it as within bounds.

## Change

- Measure `rawHeaders` including the separator and CRLFs when available.
- Also measure the parsed header map, using the larger of the two totals.
- Preserve the configured threshold and existing rejection response.

## Verification

- Construct a request with known header pairs and assert the total includes separators and CRLFs.
- Add a header after parsing and assert the larger parsed total is used.
- Test a request just below and just above the threshold.

Closes #19452
