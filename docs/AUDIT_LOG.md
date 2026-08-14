# Audit Log

## Overview

The Truxify backend records an audit trail of sensitive operations (`middleware/auditLog.js` + `services/auditLogService.js`): who did what, to which resource, with before/after state and timing.

---

## Location

```
backend/api/src/middleware/auditLog.js
backend/api/src/services/auditLogService.js
```

---

## Behavior

`auditLog({ action, resourceType, getBeforeState, getAfterState, getMetadata, shouldLog })`:

- Runs after `authenticate`; requests without a user are skipped.
- Captures before-state before the handler runs, then writes the audit entry when the response finishes.
- Records: actor (id, role, name), action, resource type/id, method, path, IP, user-agent, correlation/request IDs, status code, before/after state, and metadata with duration.
- `shouldLog` can filter which requests are audited.

### PII Scrubbing

Every audit entry passes through `scrubPii`, which recursively redacts sensitive keys (`password`, `token`, `otp`, `authorization`, `api_key`, `cvv`, `pin`, ...) and masks 16-digit card numbers, so credentials never reach the audit table.

### Convenience Helpers

- `auditAdminAction(action)` — quick audit middleware for admin operations.
- `auditWithState(action, resourceType, getIdFn)` — captures before/after rows from a Supabase table.

---

## Why It Exists

Compliance and incident response require knowing exactly what changed, by whom, and when. The audit trail also deters abuse of privileged operations.

---

## Testing

Automated tests verify:

- Entry capture and filtering.
- Before/after state capture.
- PII redaction (keys, nesting, card numbers).
- Convenience helpers.
