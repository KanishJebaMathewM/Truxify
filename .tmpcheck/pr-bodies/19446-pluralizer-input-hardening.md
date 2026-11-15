## Problem

`getPluralForm()` and `formatMessage()` in `backend/api/src/lib/pluralizer.js` assume locale, count, template, and variables have usable types. A non-string locale throws on `.split()`, a `BigInt` or `Symbol` count throws in `Number()`, and a missing template throws on `.replace()`. These values can originate from notification payloads and request data.

## Change

- Coerce only supported primitives, default non-string locales to English, and normalize counts to a finite non-negative number.
- Convert non-string templates safely and return an empty string for a missing message.
- Treat non-object variable maps as empty and stringify values only when present.

## Verification

- Test `null`, `undefined`, numbers, objects, symbols, and BigInt counts.
- Test missing and non-string templates and non-object variables.
- Assert valid English and locale-specific plural forms are unchanged.

Closes #19446
