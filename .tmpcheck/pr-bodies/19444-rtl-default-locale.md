## Problem

`isRTL()` in `backend/api/src/lib/formatters.js` calls `locale.split('-')` before checking that `locale` is a string. A missing value uses the default, but `null`, a number, an object, or an empty string passed by a caller causes a TypeError or an incorrect lookup. RTL formatting is used when producing localized notifications and UI text.

## Change

- Reject non-string and whitespace-only locales before calling `split()`.
- Return `false` for those inputs so the default LTR direction is used.
- Preserve the existing RTL language list and matching behavior for valid locales.

## Verification

- Call `isRTL()` with `undefined`, `null`, `''`, `'   '`, a number, and an object; assert false and no throw.
- Assert `ur-PK`, `ar-EG`, `he-IL`, and `fa-IR` return true.
- Run the formatter tests.

Closes #19444
