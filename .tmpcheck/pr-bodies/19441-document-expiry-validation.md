## Problem

`checkExpiry()` in `backend/api/src/lib/documentValidator.js` used `new Date(expiryDate)` and then compared it with the current time. An invalid date produces `NaN`, and every comparison against `NaN` is false, so the function returned `expired: false`. A document with a missing, unreadable, or malformed expiry date could therefore pass verification.

## Change

- Return `expired: true` with a `missing_expiry` reason when no value is supplied.
- Parse ISO and day-first `DD/MM/YYYY` dates explicitly, validate the calendar components, and return `invalid_expiry` for anything else.
- Preserve the existing warning window and day count for valid future dates.

## Verification

- Test missing, `not-a-date`, impossible calendar dates, and valid ISO and day-first dates.
- Assert invalid values fail closed and valid day-first dates produce the expected days until expiry.
- Run the document verification tests, including the valid document fixture.

Closes #19441
