## Problem

`getPluralForm()` and `formatMessage()` in `backend/api/src/lib/pluralizer.js` assume locale, count, template, and variables have usable types. A non-string locale throws on `.split()`, a `BigInt` or `Symbol` count throws in `Number()`, and a missing template throws on `.replace()`. These values can originate from notification payloads and request data.

## Root cause

The functions perform string and numeric operations before validating input. The fallback rules cover unknown locales but not malformed types, and the interpolation path assumes the template and variables object are always present.

## Impact

- A malformed notification payload can throw while rendering a message, causing the whole notification batch to fail.
- Symbol and BigInt counts are valid JavaScript values but crash the numeric path.
- Missing templates or non-object variable maps turn a formatting concern into an unhandled exception.

## Proposed fix

- Coerce only supported primitives, default non-string locales to English, and normalize counts to a finite non-negative number.
- Convert non-string templates safely and return an empty string for a missing message.
- Treat non-object variable maps as empty and stringify values only when present.

## Verification

- Test `null`, `undefined`, numbers, objects, symbols, and BigInt counts.
- Test missing and non-string templates and non-object variables.
- Assert valid English and locale-specific plural forms are unchanged.

Request: @Senthil455 please assign this issue.
