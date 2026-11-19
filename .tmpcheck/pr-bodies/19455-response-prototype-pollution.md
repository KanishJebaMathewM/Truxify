## Problem

`responseSanitizer` in `backend/api/src/middleware/responseSanitizer.js` copies sanitized keys with `out[key] = value`. If a JSON response contains an own `__proto__` key, that assignment changes the prototype of the sanitized object instead of creating a data property. Similar keys such as `constructor` and `prototype` can corrupt downstream merges.

## Change

- Skip `__proto__`, `constructor`, and `prototype` while copying sanitized response fields.
- Continue to apply the existing sensitive-field filtering to all other keys.
- Keep the response shape unchanged for normal payloads.

## Verification

- Sanitize a payload with an own `__proto__` key and assert `Object.prototype` is unchanged and the key is absent.
- Test nested `constructor` and `prototype` keys.
- Run the response sanitizer tests and assert ordinary fields survive.

Closes #19455
