## Problem

`responseSanitizer` in `backend/api/src/middleware/responseSanitizer.js` copies sanitized keys with `out[key] = value`. If a JSON response contains an own `__proto__` key, that assignment changes the prototype of the sanitized object instead of creating a data property. Similar keys such as `constructor` and `prototype` can corrupt downstream merges.

## Root cause

The sanitizer iterates entries from parsed JSON, where `__proto__` is an ordinary own property, and writes them to a normal object. It does not skip prototype-sensitive keys, so the assignment semantics of JavaScript take over.

## Impact

- Inherited fields from a polluted prototype can appear in API responses or authorization checks.
- Serialization can emit unexpected keys or omit legitimate data, breaking clients.
- A malicious or malformed upstream response can contaminate the process-wide object graph.

## Proposed fix

- Skip `__proto__`, `constructor`, and `prototype` while copying sanitized response fields.
- Continue to apply the existing sensitive-field filtering to all other keys.
- Keep the response shape unchanged for normal payloads.

## Verification

- Sanitize a payload with an own `__proto__` key and assert `Object.prototype` is unchanged and the key is absent.
- Test nested `constructor` and `prototype` keys.
- Run the response sanitizer tests and assert ordinary fields survive.

Request: @Senthil455 please assign this issue.
