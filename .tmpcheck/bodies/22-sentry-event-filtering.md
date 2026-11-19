## Problem

`beforeSend` in `backend/api/src/middleware/sentry.js` filtered events using `shouldIgnoreError()`, which checks `err.code`. Sentry events do not expose the original error object in that shape; the code is usually in `exception.values[].type` or inside the exception message. Expected connection resets and timeouts therefore continue to create issues and alerts.

## Root cause

The filter was written against a live Error object but is invoked with a serialized Sentry event. The two shapes differ, so the `code` comparison always misses for normal captured exceptions.

## Impact

- Expected network churn from Redis, Postgres, or upstream HTTP clients floods Sentry and obscures real regressions.
- Alert fatigue leads operators to ignore the error stream or disable notifications.
- Every filtered event still consumes ingestion quota and processing time.

## Proposed fix

- Add a `shouldIgnoreEvent()` predicate that inspects every `exception.values[]` entry.
- Match the filter code against both the exception type and the message text.
- Use the new predicate in `beforeSend` while keeping the live-error helper for direct callers.

## Verification

- Build events with `type: 'ECONNRESET'` and with the code only in the value and assert both return null.
- Assert unrelated exception types and messages are still sent.
- Run the Sentry middleware tests.

Request: @Senthil455 please assign this issue.
