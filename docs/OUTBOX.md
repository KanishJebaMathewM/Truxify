# Transactional Outbox

## Overview

The Truxify backend uses the transactional outbox pattern to publish domain events reliably. Event records are written durably in the same logical operation as the order mutation, and a relay worker publishes them to the event bus — so no event is lost if the process crashes between the write and the publish.

---

## Location

```
backend/api/src/services/outbox/outboxService.js   — outbox writes/fetches
backend/api/src/workers/outboxRelayWorker.js       — relay loop
```

---

## Flow

1. **Write** — `writeEvent({ aggregateId, eventType, payload })` inserts a `pending` row into `outbox_events` with a UUID, retry count 0, and timestamp.
2. **Relay** — `outboxRelayWorker` runs on an interval (`OUTBOX_RELAY_INTERVAL_MS`, default 5 s):
   - Requeues failed events below `OUTBOX_MAX_RETRIES`.
   - Fetches up to 50 pending events.
   - Publishes each through the event bus (`emitSafe`), idempotent on the consumer side.
   - Marks the event `published` on success, `failed` (with an incremented `retry_count` and error message) on failure.
3. **Retry** — failed events are requeued until they succeed or hit the max-retry cap.

---

## Why It Exists

A naive "publish event after writing the order" flow loses events when the process dies between the two steps, or publishes events for orders that never committed. The outbox makes the write and the event atomic in effect, which matters for payment, escrow, and notification flows that must not be dropped.

---

## Testing

Automated tests verify:

- Outbox writes, pending fetches, and published/failed transitions.
- Retry-count incrementation.
- Relay worker publish/mark-published and failure paths.
