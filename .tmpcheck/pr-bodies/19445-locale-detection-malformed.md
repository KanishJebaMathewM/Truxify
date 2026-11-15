## Problem

`detectLocale()` and `parseAcceptLanguage()` in `backend/api/src/lib/localeDetector.js` assume query parameters and headers are strings. Express can produce arrays for repeated parameters, and clients can send empty entries or non-numeric quality values. Calling string methods on those values throws, and a malformed `q` value can reorder the language preference list unpredictably.

## Change

- Normalize arrays and non-strings to a trimmed string before matching.
- Filter empty language entries and place non-finite qualities after valid qualities.
- Preserve exact locale matching, then language-only matching, then the default fallback.

## Verification

- Test array-valued query and header inputs, empty strings, and whitespace around locale codes.
- Test `q=abc`, negative qualities, and mixed valid/invalid entries; assert a deterministic supported locale.
- Run the locale detector and formatter tests.

Closes #19445
