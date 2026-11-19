## Problem

`verifyOtpHash()` in `backend/api/src/lib/otpHashing.js` accepts `null`, `undefined`, and whitespace-only strings as submitted OTPs. It proceeds to hash the empty value and compare it with the stored record. If a legacy or malformed record contains a hash of an empty value, the function returns true and the caller treats the request as authenticated.

## Change

- Reject `null`, `undefined`, and strings whose trimmed value is empty before touching the stored record.
- Return `false` immediately so no hash is computed and no comparison is attempted.
- Leave the salted and legacy hash verification paths unchanged for non-empty inputs.

## Verification

- Call the verifier with `null`, `undefined`, `''`, `' '`, and `'\t'` and assert every result is false.
- Assert that a valid OTP still verifies against both salted and legacy records.
- Run the focused OTP hashing tests.

Closes #19440
