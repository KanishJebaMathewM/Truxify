## Problem

The cookie sanitizer in `backend/api/src/middleware/cookieSecurityValidator.js` rebuilds cookies using only name and value, dropping `Max-Age`, `Expires`, `Domain`, `Path`, and vendor attributes. It also reflects values containing CRLF or semicolons, which can terminate the header or inject extra cookie attributes.

## Change

- Validate cookie names against the HTTP token grammar and reject values containing CRLF or semicolons.
- Preserve all non-security attributes while keeping the validator's `HttpOnly`, `Secure`, and `SameSite` policy.
- Apply the same name/value validation to the single-cookie helper.

## Verification

- Round-trip a cookie with `Path`, `Domain`, `Max-Age`, and `Expires` and assert the attributes survive.
- Test CRLF, semicolon, empty-name, and non-token names and assert an empty result.
- Run the cookie security validator tests.

Closes #19451
