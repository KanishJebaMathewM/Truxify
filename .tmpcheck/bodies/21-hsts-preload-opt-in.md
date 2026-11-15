## Problem

`securityHeaders` in `backend/api/src/middleware/securityHeaders.js` enables the HSTS `preload` directive when the preload environment variable is unset. HSTS preload is a one-way commitment: once a domain is accepted by the browser preload list, removing the header does not immediately remove the policy from clients.

## Root cause

The default was chosen as `true`, so every deployment that did not configure the variable advertised preload eligibility. There is no distinction between an unset variable and an explicit opt-in.

## Impact

- A staging or internal domain can be submitted to the public preload list without an intentional decision.
- Operators cannot roll back HTTPS-only behavior for a domain after preload propagation.
- A misconfigured deployment can strand users on HTTP-only clients or break certificate rollback procedures.

## Proposed fix

- Treat only the exact values `true` and `1` as opt-in.
- Omit the `preload` directive for every other value, including unset, empty, `false`, and `yes`.
- Keep the rest of the HSTS header and max-age behavior unchanged.

## Verification

- Assert `preload` is absent when the variable is unset, empty, `false`, or `yes`.
- Assert `preload` is present for `true` and `1`.
- Run the security headers tests.

Request: @Senthil455 please assign this issue.
