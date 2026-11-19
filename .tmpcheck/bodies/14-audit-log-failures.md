## Problem

The audit middleware in `backend/api/src/middleware/auditLogger.js` calls `queueAuditLog()` directly. If that function returns a rejected promise, the rejection is unhandled; if it throws synchronously, the error can escape the response path. Audit storage is a secondary concern and must not turn a successful business request into a process-level failure.

## Root cause

There is no single wrapper around the enqueue call, and each call site is responsible for handling both synchronous and asynchronous failures. The queue implementation can fail during a database outage, Redis outage, or JSON serialization error.

## Impact

- A database or queue outage can produce unhandled rejections and terminate the API process.
- A successful order or payment response can be lost because the audit write failed after the business operation committed.
- Repeated failures can generate a rejection storm and obscure the original outage.

## Proposed fix

- Add an `enqueueAuditLog()` helper that catches synchronous throws and attaches a rejection handler.
- Log the failure with the event type and error, without rethrowing.
- Route every audit enqueue call site through the helper.

## Verification

- Make `queueAuditLog()` reject and assert the middleware still calls `next()` and logs one error.
- Make it throw synchronously and assert the same behavior.
- Run the audit middleware tests and a happy-path audit write test.

Request: @Senthil455 please assign this issue.
