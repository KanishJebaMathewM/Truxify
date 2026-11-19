## Problem

`tracingMiddleware` in `backend/api/src/middleware/tracingMiddleware.js` registers `finish`, `error`, and `close` handlers that each call `span.end()`. An aborted or errored response can emit more than one terminal event, so the span is ended twice, producing duplicate exports and a corrupted duration.

## Change

- Introduce a single `endSpan()` closure guarded by a `spanEnded` boolean.
- Map `finish` to the real status, `error` to 500 with the exception, and incomplete `close` to 499.
- Register all three listeners through the guarded function.

## Verification

- Emit `finish` followed by `close` and assert `span.end()` is called once.
- Emit `error` followed by `close` and assert the error status and exception are recorded once.
- Emit only `close` without `writableEnded` and assert status 499.

Closes #19459
