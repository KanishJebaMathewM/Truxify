# Webhooks & DLQ

## Overview

The Truxify backend processes webhook events (escrow lifecycle) with retry, exponential backoff, and a dead-letter queue so events are never silently dropped.

---

## Location

```
backend/api/src/services/webhook/escrowWebhookProcessor.js — escrow webhook handling
backend/api/src/services/webhook/dlqService.js            — retry/backoff + DLQ
backend/api/src/routes/webhookRoutes.js                   — HTTP surface
```

---

## Escrow Webhooks

`escrowWebhookProcessor`:

- Verifies the event signature/authenticity.
- Maps the event to the order lifecycle action (deposit confirmed, release, refund, dispute).
- Updates escrow state and reconciliation evidence.
- Unknown or unverifiable events are rejected without side effects.

## DLQ

`dlqService`:

- Retries failed events with exponential backoff (`next_retry_at` from `retry_count`).
- After the retry cap, moves the event to the dead-letter state so it can be inspected and replayed by ops.
- Records the final retry count and error in the event row.

---

## Why It Exists

Webhook delivery is inherently unreliable (third-party outages, network blips). Retries with backoff absorb transient failures; the DLQ guarantees that permanently-failing events are visible and replayable instead of lost.

---

## Testing

Automated tests verify:

- Signature verification and event mapping.
- Retry/backoff scheduling.
- DLQ promotion after max retries.
- Error handling on the webhook routes.
