## Problem

The HPP middleware in `backend/api/src/middleware/hppProtection.js` only normalizes top-level query parameters. Nested objects such as `filter[status]=active&filter[status]=cancelled` retain an array, and prototype keys such as `__proto__`, `constructor`, and `prototype` are copied into the request query object.

## Change

- Recursively normalize arrays to their first value and record each nested duplicate path.
- Delete `__proto__`, `constructor`, and `prototype` keys during traversal.
- Expose duplicate paths in the existing request metadata and preserve scalar values.

## Verification

- Send nested repeated parameters and assert only the first value remains for each leaf.
- Send prototype-pollution keys at multiple depths and assert they are removed.
- Assert the duplicate-parameter list reports the full nested path.

Closes #19453
