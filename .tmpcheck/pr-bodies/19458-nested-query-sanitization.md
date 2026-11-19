## Problem

`sanitizeQueryParams()` in `backend/api/src/middleware/suspiciousRequests.js` only filters top-level keys. Nested objects and arrays are copied by reference, so dangerous keys such as `__proto__` and `constructor` survive inside them. Deeply nested or cyclic input can also cause unbounded recursion.

## Change

- Traverse arrays and nested objects recursively with the same prohibited-key filter.
- Add a depth limit and a `WeakSet` cycle guard.
- Return a sanitized copy so the original request object is not mutated unexpectedly.

## Verification

- Sanitize nested objects and arrays containing `__proto__`, `constructor`, and `prototype`; assert they are removed at every depth.
- Test a cyclic object and a deeply nested object and assert a safe empty or bounded result.
- Assert ordinary nested query data is preserved.

Closes #19458
