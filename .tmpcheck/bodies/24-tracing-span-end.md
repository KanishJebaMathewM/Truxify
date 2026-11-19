## Problem

`tracingMiddleware` in `backend/api/src/middleware/tracingMiddleware.js` registers `finish`, `error`, and `close` handlers that each call `span.end()`. An aborted or errored response can emit more than one terminal event, so the span is ended twice, producing duplicate exports and a corrupted duration.

## Root cause

Each lifecycle handler owns its own end call and there is no shared once-only guard. The `close` path also records a 499 status even when the response already finished normally, depending on event ordering.

## Impact

- Trace backends receive duplicate spans with inconsistent durations, corrupting latency dashboards and alerts.
- Double-ending a span can throw in some OpenTelemetry exporters and mask the original request error.
- Aborted requests are misclassified as successful or as 499 depending on event order.

## Proposed fix

- Introduce a single `endSpan()` closure guarded by a `spanEnded` boolean.
- Map `finish` to the real status, `error` to 500 with the exception, and incomplete `close` to 499.
- Register all three listeners through the guarded function.

## Verification

- Emit `finish` followed by `close` and assert `span.end()` is called once.
- Emit `error` followed by `close` and assert the error status and exception are recorded once.
- Emit only `close` without `writableEnded` and assert status 499.

Request: @Senthil455 please assign this issue.
