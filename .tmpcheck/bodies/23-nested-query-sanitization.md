## Problem

`sanitizeQueryParams()` in `backend/api/src/middleware/suspiciousRequests.js` only filters top-level keys. Nested objects and arrays are copied by reference, so dangerous keys such as `__proto__` and `constructor` survive inside them. Deeply nested or cyclic input can also cause unbounded recursion.

## Root cause

The function iterates `Object.entries()` once and assigns nested values directly. It has no depth limit, no cycle detection, and no array handling, even though query parsers commonly produce nested objects and repeated parameters produce arrays.

## Impact

- Callers that rely on this sanitizer can still receive prototype-pollution payloads nested one level down.
- A deeply nested query can exhaust the stack during sanitization.
- Arrays of objects bypass the key filter entirely, creating an inconsistent security boundary.

## Proposed fix

- Traverse arrays and nested objects recursively with the same prohibited-key filter.
- Add a depth limit and a `WeakSet` cycle guard.
- Return a sanitized copy so the original request object is not mutated unexpectedly.

## Verification

- Sanitize nested objects and arrays containing `__proto__`, `constructor`, and `prototype`; assert they are removed at every depth.
- Test a cyclic object and a deeply nested object and assert a safe empty or bounded result.
- Assert ordinary nested query data is preserved.

Request: @Senthil455 please assign this issue.
