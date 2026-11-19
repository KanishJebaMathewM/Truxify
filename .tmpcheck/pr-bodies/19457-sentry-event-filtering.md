## Problem

`beforeSend` in `backend/api/src/middleware/sentry.js` filtered events using `shouldIgnoreError()`, which checks `err.code`. Sentry events do not expose the original error object in that shape; the code is usually in `exception.values[].type` or inside the exception message. Expected connection resets and timeouts therefore continue to create issues and alerts.

## Change

- Add a `shouldIgnoreEvent()` predicate that inspects every `exception.values[]` entry.
- Match the filter code against both the exception type and the message text.
- Use the new predicate in `beforeSend` while keeping the live-error helper for direct callers.

## Verification

- Build events with `type: 'ECONNRESET'` and with the code only in the value and assert both return null.
- Assert unrelated exception types and messages are still sent.
- Run the Sentry middleware tests.

Closes #19457
