## Problem

`isRTL()` in `backend/api/src/lib/formatters.js` calls `locale.split('-')` before checking that `locale` is a string. A missing value uses the default, but `null`, a number, an object, or an empty string passed by a caller causes a TypeError or an incorrect lookup. RTL formatting is used when producing localized notifications and UI text.

## Root cause

The function's guard was added only around the final language comparison, not around the string operations that precede it. JavaScript default parameters cover `undefined` but not `null` or non-string values from request data or database rows.

## Impact

- A malformed locale can turn a formatting request into a 500 instead of falling back to left-to-right output.
- Arabic, Urdu, Hebrew, and Farsi users may receive incorrect alignment when locale data is missing or malformed.
- The same helper is exported for reuse, so the crash can appear in any caller that accepts external locale values.

## Proposed fix

- Reject non-string and whitespace-only locales before calling `split()`.
- Return `false` for those inputs so the default LTR direction is used.
- Preserve the existing RTL language list and matching behavior for valid locales.

## Verification

- Call `isRTL()` with `undefined`, `null`, `''`, `'   '`, a number, and an object; assert false and no throw.
- Assert `ur-PK`, `ar-EG`, `he-IL`, and `fa-IR` return true.
- Run the formatter tests.

Request: @Senthil455 please assign this issue.
