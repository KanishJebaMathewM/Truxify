## Problem

The audit middleware in `backend/api/src/middleware/auditLogger.js` calls `queueAuditLog()` directly. If that function returns a rejected promise, the rejection is unhandled; if it throws synchronously, the error can escape the response path. Audit storage is a secondary concern and must not turn a successful business request into a process-level failure.

## Change

- Add an `enqueueAuditLog()` helper that catches synchronous throws and attaches a rejection handler.
- Log the failure with the event type and error, without rethrowing.
- Route every audit enqueue call site through the helper.

## Verification

- Make `queueAuditLog()` reject and assert the middleware still calls `next()` and logs one error.
- Make it throw synchronously and assert the same behavior.
- Run the audit middleware tests and a happy-path audit write test.

Closes #19449
